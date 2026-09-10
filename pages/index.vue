<template>
  <div class="layout">
    <main class="cols">
      <!-- 左栏：参数输入 -->
      <div class="col col-input">
      <!-- ⓪ 工作流选择（紧凑下拉菜单） -->
      <div class="wf-bar card compact">
        <span class="wf-sel-icon">📂</span>
        <select class="wf-select" :value="selectedFile" @change="onWfSelect($event)">
          <option v-if="!workflows.length" value="">暂无工作流</option>
          <option v-for="wf in workflows" :key="wf.file" :value="wf.file" :disabled="wf.broken">
            {{ wf.name }}{{ runningOnWorkflow(wf.file) ? ' ● 进行中' : '' }}{{ wf.broken ? '（JSON 解析失败）' : '' }}
          </option>
        </select>
        <span v-if="runningCount" class="wf-running" title="有批次正在生成">● {{ runningCount }} 进行中</span>
      </div>

      <!-- ① 生成控制 & 提示词 & 参考图 & 参数 -->
      <div class="card">
        <!-- 生成按钮（最上面） -->
        <div class="gen-actions top">
          <span class="plan" :class="{ warn: !canSubmit }">{{ planText }}</span>
          <button class="btn primary" :class="{ flash: submitFlash }" :disabled="submitting || !canSubmit" title="快捷键：Ctrl+Enter" @click="submitBatch">▶ 开始批量生成 <kbd class="kbd-hint">Ctrl+↵</kbd></button>
        </div>
        <div v-if="progress.status === 'error'" class="status-line error" style="margin-top:8px">{{ progress.message }}</div>

        <!-- 批次 / seed -->
        <div class="gen-row">
          <div class="gen-block grow">
            <label>批次（每张图跑几单）</label>
            <div class="seed-row">
              <input type="number" min="1" max="50" v-model.number="batchCount" />
              <div class="quick-row">
                <button v-for="n in [1,2,3,4]" :key="n" class="btn quick" :class="{ on: batchCount===n }" @click="batchCount=n">{{ n }}</button>
              </div>
            </div>
          </div>
          <div class="gen-block grow">
            <label class="inline-label">
              <input type="checkbox" v-model="autoRandSeed" />
              每单自动随机 seed
            </label>
            <div v-if="!autoRandSeed" class="seed-row" style="margin-top:6px">
              <input type="number" v-model.number="fixedSeedVal" placeholder="所有单复用这个 seed" />
            </div>
            <div v-if="pendingReuseSeed !== null" class="seed-reuse" style="margin-top:6px">
              🌱 复用 seed：<b>{{ pendingReuseSeed }}</b>（下一批的第一单使用一次，其余单按上方设置）
            </div>
          </div>
        </div>

        <!-- 提示词区：中（主要编辑区，独占加高）在前，首/尾一行在后 -->
        <template v-for="(row, ri) in promptRowsOrdered" :key="'pr'+ri">
          <div :class="['prompt-row', { multi: row.length > 1 }]">
            <div v-for="group in row" :key="group.nodeId" class="node-group">
              <div class="group-title row">
                <span>✏️ {{ group.title }}</span>
                <button v-if="group.title.includes('中')" class="btn mini" title="把剪贴板内容粘贴到「中」提示词" @click="pastePromptGroup(group)">📋 粘贴</button>
                <button v-if="group.title.includes('中')" class="btn mini" title="将提示词中的「小金毛」与「小白」互换" @click="swapPromptChars(group)">🔄 交换</button>
                <button class="btn mini danger" @click="clearPromptGroup(group)">清空</button>
              </div>
              <div v-for="f in group.fields" :key="f.uid" class="field">
                <FieldControl :field="f" v-model="form[f.uid]" :hide-label="group.fields.length === 1 && group.fields[0].label === group.title" />
              </div>
            </div>
          </div>
        </template>

        <!-- 参考图队列（在提示词下方） -->
        <div class="card nested">
          <h2>
            🖼 参考图（{{ images.length }}）
            <button class="btn mini" style="margin-left:auto" title="点击选择或拖拽资产到此按钮：PNG 直接解析 ComfyUI 内嵌工作流（任意机器生成均可）；图片/视频也可按文件名反查服务器历史复用" @click="($refs.assetFileInput as any)?.click()" @dragover.prevent @drop.prevent="onAssetDrop">♻️ 从资产复用</button>
            <input ref="assetFileInput" type="file" accept="image/*,video/mp4,video/webm" hidden @change="onAssetFile" />
            <button v-if="images.length" class="btn mini danger" @click="clearImages">清空</button>
          </h2>
          <div v-if="!selectedFile" class="empty">↑ 先在上方选择一个工作流</div>
          <template v-else>
            <div
              class="dropzone"
              :class="{ over: dragging }"
              @dragover.prevent="dragging = true"
              @dragleave.prevent="dragging = false"
              @drop.prevent="onDrop"
              @click="$refs.fileInput && $refs.fileInput.click()"
            >
              <div class="dz-hint">
                📤 点击 或 拖拽图片到此处（可多选）
                <template v-if="isVideoWf"> · 本工作流每单最多 {{ imageSlots }} 张一组（Picture 1 → 2 → 3 顺序），上传几张就启用几张</template>
                <template v-else> · 多张图将<b>轮流</b>与当前提示词组合，逐张 × 批次连发</template>
              </div>
              <input
                ref="fileInput"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                @change="(e) => onPickFiles(e)"
              />
            </div>

            <div v-if="images.length" class="img-grid">
              <div
                v-for="(img, idx) in images"
                :key="img.id"
                class="img-cell"
                draggable="true"
                @dragstart="dragIdx = idx"
                @dragover.prevent
                @drop="dropAt(idx)"
                @dblclick="removeImage(idx)"
              >
                <div class="img-thumb">
                  <img :src="img.src" alt="参考图" loading="lazy" />
                  <span v-if="uploadingId === img.id" class="img-uploading">上传中…</span>
                  <button class="img-x" title="移除" @click.stop="removeImage(idx)">✕</button>
                  <span v-if="batchIndex.includes(idx)" class="img-idx" :title="slotBadgeTitle(idx)">{{ slotBadge(idx) }}</span>
                </div>
                <div class="img-name" :title="img.name">{{ img.name }}</div>
              </div>
            </div>
          </template>
        </div>

        <!-- 常用参数（常驻展示，一行排列） -->
        <div v-if="commonFields.length" class="node-group common">
          <div class="group-title">🎛 常用参数</div>
          <div class="common-row">
            <div v-for="f in commonFields" :key="f.uid" class="field">
              <FieldControl :field="f" v-model="form[f.uid]" />
            </div>
          </div>
        </div>

        <!-- 高级参数（折叠） -->
        <div v-if="advancedFields.length" class="node-group adv">
          <div class="group-title" @click="toggleAdv">
            ⚙️ 高级参数（一般不用动）
            <span class="muted">{{ advOpen ? '▾ 收起' : '▸ 展开' }}</span>
          </div>
          <template v-if="advOpen">
            <div v-for="f in advancedFields" :key="f.uid" class="field">
              <FieldControl :field="f" v-model="form[f.uid]" />
            </div>
          </template>
        </div>
      </div>
      </div>

      <!-- 右栏：产出 -->
      <div class="col col-output">
      <!-- ③ 本批结果 -->
      <div class="card batch-result-card" v-if="batchDoneOutputs.length">
        <h2>✨ 本次批量结果（{{ batchDoneOutputs.length }}）</h2>
        <div class="grid">
          <div v-for="(r, i) in batchDoneOutputs" :key="i" class="result-item">
            <div class="result-media">
              <img v-if="r.kind === 'image'" :src="r.src" loading="lazy" @click="openViewer(r.src, r.filename, 'image')" />
              <video v-else-if="r.kind === 'video'" :src="r.src" muted loop playsinline preload="metadata" @mouseenter="hoverPlay" @mouseleave="hoverPause" @click="openViewer(r.src, r.filename, 'video')" />
              <div v-else class="muted" style="padding:12px">不支持预览</div>
            </div>
            <div class="result-foot">
              <span class="fn" :title="r.filename">{{ r.filename }}</span>
              <span v-if="fmtDur(r.durationMs)" class="time-chip" title="该单生成耗时">⏱ {{ fmtDur(r.durationMs) }}</span>
              <a class="btn mini" :href="r.src" :download="r.filename">下载</a>
            </div>
          </div>
        </div>
      </div>

      <!-- ③½ 本会话批次（固定高度，最近产出上方） -->
      <div class="card batch-list-card">
        <h2>📋 本会话批次（{{ runningCount }} 进行中 · 点击行查看结果）</h2>
        <div v-if="!sessionBatches.length" class="empty">还没有批次，点击左侧「开始批量生成」发起</div>
        <div v-else class="batch-list">
          <div
            v-for="b in sessionBatches"
            :key="b.id"
            class="batch-row"
            :class="{ sel: b.id === selectedBatchId, done: !!b.finishedAt && !b.cancelled, cancelled: b.cancelled }"
            @click="selectedBatchId = b.id"
          >
            <div class="batch-row-head">
              <span class="batch-wf">{{ shortWf(b.workflow) }}</span>
              <span class="batch-info">{{ batchTextOf(b) }}</span>
              <button v-if="!b.finishedAt && !b.cancelled" class="btn mini danger" @click.stop="stopBatch(b.id)">⏹ 停止</button>
              <span v-else class="batch-tag" :class="{ ok: !!b.finishedAt && !b.cancelled }">{{ b.cancelled ? '已停止' : '完成' }}</span>
            </div>
            <div class="progress-track"><div class="progress-bar" :style="{ width: percentOf(b) + '%' }"></div></div>
          </div>
        </div>
      </div>

      <!-- ④ 最近产出 -->
      <div class="card history-card">
        <h2>
          🗂 最近产出（{{ history.length }}）
          <button class="btn mini" title="快捷键：R（非输入状态）" @click="refreshHistory(true)" style="margin-left:auto">刷新 <kbd class="kbd-hint">R</kbd></button>
          <button class="btn mini danger" title="隐藏当前显示的全部历史资产（📌 固定的保留；不影响服务器上的文件）" @click="clearHistory">🧹 清空</button>
        </h2>
        <div v-if="history.length === 0" class="empty">暂无历史产出</div>
        <div v-else class="grid">
          <div v-for="item in historyView" :key="item.promptId" :class="['result-item', { pinned: isPinned(item) }]" title="右键打开操作菜单" @click.capture="markRead(item)" @contextmenu.prevent="openCtxMenu($event, item)">
            <div class="result-media">
              <span v-if="!isRead(item)" class="unread-badge" title="未读">NEW</span>
              <span v-if="isPinned(item)" class="pin-badge" title="已固定（清空时保留）">📌</span>
              <template v-if="item.outputs.length">
                <img v-if="item.outputs[0].kind === 'image'" :src="mediaUrl(item.outputs[0])" loading="lazy" @click="openViewer(mediaUrl(item.outputs[0]), item.outputs[0].filename, 'image', item)" />
                <template v-else-if="item.outputs[0].kind === 'video'">
                  <video :src="mediaUrl(item.outputs[0])" muted loop playsinline preload="metadata" @mouseenter="hoverPlay" @mouseleave="hoverPause" @click="openViewer(mediaUrl(item.outputs[0]), item.outputs[0].filename, 'video', item)" />
                  <span class="video-hint">▶ 悬停播放 · 点击放大</span>
                </template>
              </template>
            </div>
            <div class="result-foot">
              <div class="result-meta">
                <span v-if="fmtDur(item.durationMs)" class="time-chip" title="生成耗时">⏱ {{ fmtDur(item.durationMs) }}</span>
                <span class="fn asset-name" :title="assetName(item) || item.promptId"><template v-if="assetName(item)">🏷 {{ assetName(item) }}</template><template v-else>{{ item.promptId.slice(0, 8) }}…</template></span>
                <button class="btn mini more-btn" title="更多操作：下载 / 复制中提示词 / 固定 / 重命名 / 删除（也可右键卡片）" @click.stop="openCtxMenu($event, item)">⋯</button>
              </div>
              <button class="btn mini reuse-btn" title="读取该资产提交时的完整工作流：自动匹配工作流，还原所有参数（提示词/seed/分辨率/时长/LoRA）与参考图" @click="applyAssetParams(item)">♻️ 复用全部参数</button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </main>

    <!-- 轻提示 -->
    <div v-if="toast" style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e2235;color:#fff;padding:10px 20px;border-radius:12px;font-size:13px;z-index:200;box-shadow:0 8px 30px rgba(0,0,0,.25);pointer-events:none">{{ toast }}</div>

    <!-- 资产右键菜单 -->
    <div v-if="ctxMenu" style="position:fixed;inset:0;z-index:150" @click="ctxMenu = null" @contextmenu.prevent="ctxMenu = null"></div>
    <div v-if="ctxMenu" class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
      <button @click="ctxDo(applyAssetParams)">♻️ 复用全部参数</button>
      <button @click="ctxDo(copyMidPrompt)">📋 复制中提示词</button>
      <button @click="ctxDo(downloadItem)">⬇ 下载资产</button>
      <button @click="ctxDo(renameAsset)">✏️ 重命名</button>
      <button @click="ctxDo(togglePin)">{{ isPinned(ctxMenu.item) ? '📌 取消固定' : '📍 固定（清空时保留）' }}</button>
      <button @click="ctxDo(toggleRead)">{{ isRead(ctxMenu.item) ? '👁 标为未读' : '👁 标为已读' }}</button>
      <button class="danger" @click="ctxDo(deleteHistoryItem)">🗑 删除（隐藏）</button>
    </div>

    <!-- 大图预览灯箱 -->
    <div v-if="viewer" class="lightbox" @click.self="viewer = null">
      <button class="lb-x" title="关闭" @click="viewer = null">✕</button>
      <button v-if="viewer.item" class="lb-nav prev" title="上一个（←）" @click="navViewer(-1)">‹</button>
      <button v-if="viewer.item" class="lb-nav next" title="下一个（→）" @click="navViewer(1)">›</button>
      <div class="lb-wrap" :class="{ 'has-side': viewer.item }">
        <div class="lb-media">
          <img v-if="viewer.kind === 'image'" :src="viewer.src" :alt="viewer.filename" />
          <video v-else :src="viewer.src" controls autoplay loop></video>
          <div class="lb-bar">
            <span class="fn">{{ viewer.item ? downloadName(viewer.item) : viewer.filename }}</span>
            <span v-if="viewer.item" class="lb-pos">{{ viewerIndex() + 1 }} / {{ historyView.length }}</span>
            <a class="btn small" :href="viewer.src" :download="viewer.item ? downloadName(viewer.item) : viewer.filename">⬇ 下载原图</a>
          </div>
        </div>
        <aside v-if="viewer.item" class="lb-side" @click.stop>
          <div class="lb-side-title">📝 中提示词</div>
          <div class="lb-side-text">{{ midPromptOf(viewer.item) || '（该资产没有中提示词）' }}</div>
          <div class="lb-side-meta">
            <span v-if="fmtDur(viewer.item.durationMs)">⏱ {{ fmtDur(viewer.item.durationMs) }}</span>
            <span class="fn" :title="viewer.item.promptId">{{ viewer.item.promptId.slice(0, 8) }}…</span>
          </div>
          <div class="lb-side-actions">
            <button class="btn mini" :title="isPinned(viewer.item) ? '取消固定' : '固定（清空最近产出时保留）'" @click="togglePin(viewer.item)">{{ isPinned(viewer.item) ? '📌 已固定' : '📍 固定' }}</button>
            <button class="btn mini" title="重命名资产（下载文件名将使用该名称）" @click="renameAsset(viewer.item)">✏️ 重命名</button>
            <button class="btn mini" @click="copyText(midPromptOf(viewer.item), '已复制中提示词')">📋 复制</button>
            <button class="btn mini danger" title="从最近产出中隐藏该资产（不影响服务器上的文件）" @click="deleteViewerItem()">🗑 删除</button>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// ===== 类型 =====
interface QueuedImg { id: string; name: string; src: string; serverName?: string }
interface FieldDef {
  uid: string; nodeId: string; name: string; label: string
  kind: 'textarea' | 'number' | 'select' | 'bool' | 'text'
  options?: string[]; step?: number; isSeed?: boolean; original: any
}
interface Out { kind: string; filename: string; subfolder: string; type: string; src: string; durationMs?: number }

/** 生成耗时格式化：<1s 显示毫秒，其余秒（1 位小数）；超过 60s 显示分秒 */
function fmtDur(ms?: number | null): string {
  if (ms == null || ms < 0) return ''
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`
}

// ===== 状态 =====
const workflows = ref<any[]>([])
const selectedFile = ref('')
const graph = ref<any>(null)
const form = reactive<Record<string, any>>({})
const advOpen = ref(false) // 高级参数默认折叠

const images = ref<QueuedImg[]>([])
const uploadingId = ref<string | null>(null)
const dragging = ref(false)
const dragIdx = ref<number | null>(null)

const batchCount = ref(2)
const autoRandSeed = ref(true)
// 一次性复用种子：资产复用时记录，下一批的第一单使用一次后自动清除；与「每批自动随机」勾选互相独立
const pendingReuseSeed = ref<number | null>(null)
const fixedSeedVal = ref(12345)

// 视频工作流（专属 UI 分支）：多图槽位、首/中/尾分段提示词
const isVideoWf = computed(() => /7秒视频/.test(selectedFile.value))
const history = ref<any[]>([])

const SAMPLERS = ['euler','euler_ancestral','heun','dpm_2','dpm_2_ancestral','lms','dpm_fast','dpm_adaptive','dpmpp_2s_ancestral','dpmpp_sde','dpmpp_2m','dpmpp_2m_sde','dpmpp_3m_sde','ddim','uni_pc','uni_pc_bh2','lcm','ddpm']
const SCHEDULERS = ['normal','karras','exponential','sgm_uniform','simple','ddim_uniform','beta','linear_quadratic','kl_optimal']
const clientId = Math.random().toString(36).slice(2) + Date.now().toString(36)
const pollTimer = ref<any>(null)

// ===== 会话持久化（刷新保留图片与提示词，按工作流隔离）=====
const SESSION_KEY = 'wfSession:v1'
type Session = Record<string, { images: QueuedImg[]; form: Record<string, any> }>
function readSession(): Session {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}') } catch { return {} }
}
function writeSession(s: Session) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch { /* 超出配额忽略 */ }
}
function saveSession() {
  if (restoring) return
  if (!selectedFile.value) return
  const s = readSession()
  s[selectedFile.value] = { images: images.value.map(i => ({ ...i })), form: { ...form } }
  writeSession(s)
}
let formSaveTimer: any = null
function scheduleFormSave() {
  if (restoring) return
  if (formSaveTimer) clearTimeout(formSaveTimer)
  formSaveTimer = setTimeout(() => { saveSession(); formSaveTimer = null }, 350)
}
// 切换工作流/初次加载期间跳过持久化，避免清空覆盖已保存会话
let restoring = false

// ===== 批次列表持久化：刷新后批次展示不丢；未完成的恢复后继续轮询 =====
const BATCHES_KEY = 'sessionBatches:v1'
function saveBatches() {
  try { localStorage.setItem(BATCHES_KEY, JSON.stringify(sessionBatches.value.slice(0, 30))) } catch { /* 超出配额忽略 */ }
}
function loadPersistedBatches() {
  try {
    const arr = JSON.parse(localStorage.getItem(BATCHES_KEY) || '[]')
    if (!Array.isArray(arr) || !arr.length) return
    sessionBatches.value = arr
    // 已完成的单记入 seenDoneIds，恢复时不算「新完成」
    for (const b of arr) for (const id of collectDoneIds(b)) seenDoneIds.add(id)
    // 有未完成的批次 → 恢复轮询（服务端链条独立运行，会继续推进）
    if (arr.some((b: any) => !b.finishedAt && !b.cancelled)) ensurePolling()
  } catch { /* 损坏忽略 */ }
}

// ===== 工作流 =====
const WF_KEY = 'selectedWorkflow:v1'
async function loadWorkflows() {
  try {
    const res: any = await $fetch('/api/workflows')
    workflows.value = res.workflows || []
    if (selectedFile.value) return
    // 恢复上次选择的工作流；不存在（被删/改名）时回落到第一个
    let target: any = null
    try {
      const saved = localStorage.getItem(WF_KEY)
      if (saved) target = workflows.value.find(w => w.file === saved && !w.broken) || null
    } catch {}
    if (!target && workflows.value.length) target = workflows.value[0]
    if (target) await selectWorkflow(target)
  } catch { workflows.value = [] }
}
async function selectWorkflow(wf: any) {
  if (wf.broken) return
  selectedFile.value = wf.file
  try { localStorage.setItem(WF_KEY, wf.file) } catch {}
  advOpen.value = false
  // 不清空 sessionBatches / 不停轮询：其他工作流的批次继续在批次列表里跑
  restoring = true
  images.value = []
  try { graph.value = await $fetch(`/api/workflows/${encodeURIComponent(wf.file)}`); initForm(); restoreImages() }
  catch { graph.value = null }
  finally { restoring = false; saveSession() }
}
function restoreImages() {
  images.value = []
  if (selectedFile.value) {
    const saved = readSession()[selectedFile.value]?.images
    if (saved?.length) images.value = saved.map(i => ({ ...i }))
  }
}

// LoRA 文件列表（来自 ComfyUI 服务器），用于 lora_name 字段下拉选择，杜绝手输错文件名
const loraOptions = ref<string[]>([])

function extractFields(g: any): FieldDef[] {
  const out: FieldDef[] = []
  for (const [nodeId, node] of Object.entries<any>(g || {})) {
    const inputs = node?.inputs || {}
    const title = node?._meta?.title || node?.class_type || `节点 ${nodeId}`
    for (const [name, value] of Object.entries<any>(inputs)) {
      if (Array.isArray(value) || value === null) continue
      const uid = `${nodeId}.${name}`
      let kind: FieldDef['kind'] = 'text'
      let options: string[] | undefined
      let step: number | undefined
      let isSeed = false
      const ct = String(node?.class_type || '')
      if (ct === 'LoadImage') continue // 图片走队列
      if (/ShowText/i.test(ct)) continue // 展示类节点（如 ShowText），不是输入
      // 主提示词输入名：label 直接用节点标题（如 CLIP Text Encode (Positive Prompt)）
      const isMainTextName = /^(text|prompt|value|text_0)$/i.test(name)
      const forceText = /^CLIPTextEncode/.test(ct) // CLIP 文本编码节点恒为提示词框（即使内容很短）
      if (typeof value === 'number') { kind = 'number'; isSeed = /seed/i.test(name); if (!isSeed) step = name === 'megapixels' ? 0.1 : Number.isInteger(value) ? 1 : 0.01 }
      else if (typeof value === 'boolean') kind = 'bool'
      else if (typeof value === 'string') {
        if (name === 'lora_name') { kind='select'; options=loraOptions.value.length?loraOptions.value:[String(value)] }
        else if (name === 'sampler_name') { kind='select'; options=SAMPLERS }
        else if (name === 'scheduler') { kind='select'; options=SCHEDULERS }
        else if (forceText || value.includes('\n') || (value.length > 60 && /[\u4e00-\u9fff]/.test(value))) kind='textarea' // 提示词用大输入框
        else if (/^(prompt|positive_prompt|negative_prompt|caption|positive_text|negative_text)$/i.test(name)) kind='textarea'
        else kind='text'
      }
      const label = title === name || isMainTextName ? title : `${title} · ${name}`
      out.push({ uid, nodeId, name, label, kind, options, step, isSeed, original: value })
    }
  }
  const rank = (f: FieldDef) => (f.kind==='textarea'?0:f.isSeed?1:f.kind==='number'?2:3)
  return out.sort((a,b)=>rank(a)-rank(b))
}
const fields = computed<FieldDef[]>(() => extractFields(graph.value))
const promptGroups = computed(() => {
  const m = new Map<string,{nodeId:string;title:string;fields:FieldDef[]}>()
  for (const f of fields.value.filter(f=>f.kind==='textarea')) {
    if (!m.has(f.nodeId)) m.set(f.nodeId, { nodeId:f.nodeId, title: graph.value?.[f.nodeId]?._meta?.title||'提示词', fields:[] })
    m.get(f.nodeId)!.fields.push(f)
  }
  return [...m.values()]
})
// 提示词分组布局：首/尾并排一行（上），中独占一行（下）；其余工作流保持顺序单列
const promptRows = computed(() => {
  const gs = promptGroups.value
  const byTitle = (t: string) => gs.find(g => g.title === t)
  const head = byTitle('首'), mid = byTitle('中'), tail = byTitle('尾')
  if (head && mid && tail) {
    const rest = gs.filter(g => g !== head && g !== mid && g !== tail)
    return [[head, tail], [mid], ...rest.map(g => [g])]
  }
  return gs.map(g => [g])
})
// 「中」提示词是主编辑区：渲染时排到首/尾前面
const promptRowsOrdered = computed(() => {
  const rows = promptRows.value
  const midRow = rows.find(r => r.length === 1 && r[0].title.includes('中'))
  if (!midRow) return rows
  return [midRow, ...rows.filter(r => r !== midRow)]
})
// 工作流下拉
const selectedWf = computed(() => workflows.value.find(w => w.file === selectedFile.value) || null)
function onWfSelect(e: Event) {
  const wf = workflows.value.find(w => w.file === (e.target as HTMLSelectElement).value)
  if (wf) selectWorkflow(wf)
}
// 常用参数：需要常驻展示（不折叠进高级参数）的节点标题
const COMMON_TITLES = ['Resolution Selector (Size)', 'Float (Duration)']
function isCommonField(f: FieldDef): boolean {
  return COMMON_TITLES.includes(String(graph.value?.[f.nodeId]?._meta?.title || ''))
}
const commonFields = computed(() => fields.value.filter(f=>f.kind!=='textarea' && isCommonField(f)))
const advancedFields = computed(() => fields.value.filter(f=>f.kind!=='textarea' && !isCommonField(f)))
// 提供一个入口让"固定seed"能找到对应 seed 输入
const seedField = computed(() => fields.value.find(f=>f.isSeed))

function initForm() {
  Object.keys(form).forEach(k=>delete form[k])
  for (const f of fields.value) form[f.uid] = f.original
  if (seedField.value) fixedSeedVal.value = seedField.value.original
  // 恢复该工作流上次保存的提示词（仅覆盖当前存在的字段，含未提交过的默认不覆盖）
  if (selectedFile.value) {
    const saved = readSession()[selectedFile.value]?.form
    if (saved) for (const k of Object.keys(saved)) if (k in form) form[k] = saved[k]
  }
}
function toggleAdv(){ advOpen.value = !advOpen.value }

// ===== 图片上传 =====
function makeObjUrl(file: File) {
  return new Promise<string>((resolve) => {
    const rd = new FileReader()
    rd.onload = () => resolve(rd.result as string)
    rd.readAsDataURL(file)
  })
}
async function onPickFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  await uploadFiles(files)
}
async function onDrop(e: DragEvent) {
  dragging.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  await uploadFiles(files)
}
async function uploadFiles(files: File[]) {
  const imgs = files.filter(f=>f.type.startsWith('image/'))
  if (!imgs.length) return
  const sorted: QueuedImg[] = []
  for (const file of imgs) {
    const id = Date.now().toString(36)+Math.random().toString(36).slice(2,6)
    sorted.push({ id, name: file.name, src: await makeObjUrl(file) })
  }
  // 上传到 ComfyUI 拿 serverName
  for (const q of sorted) {
    uploadingId.value = q.id
    try {
      const fd = new FormData()
      const file = imgs.find(i=>i.name===q.name)!
      fd.append('image', file)
      const res: any = await $fetch('/api/upload',{method:'POST',body:fd})
      if (res?.name) q.serverName = res.name
    } catch(err:any){ alert(`上传失败：${err?.data?.message||err?.message||err}`); continue }
    finally { uploadingId.value = null }
  }
  images.value.push(...sorted)
}
function removeImage(idx: number) {
  images.value.splice(idx,1)
}
function dropAt(targetIdx: number) {
  if (dragIdx.value===null) return
  const from = dragIdx.value
  if (from===targetIdx) return
  const arr = [...images.value]
  const [m] = arr.splice(from,1)
  arr.splice(targetIdx,0,m)
  images.value = arr
  dragIdx.value = null
}
const batchIndex = computed(()=>images.value.map((_,i)=>i)) // 简单标记全部参与
/** 多槽位工作流角标：显示组内槽位（P1/P2/P3），悬浮提示第几组 */
function slotBadge(idx: number): string {
  const slots = imageSlots.value
  if (!isVideoWf.value || slots <= 1) return String(idx + 1)
  return `P${(idx % slots) + 1}`
}
function slotBadgeTitle(idx: number): string {
  const slots = imageSlots.value
  if (!isVideoWf.value || slots <= 1) return `第 ${idx + 1} 张参与生成`
  return `第 ${Math.floor(idx / slots) + 1} 组 · Picture ${(idx % slots) + 1}`
}

// 一键清空：参考图 / 提示词
function clearImages() {
  images.value = []
  saveSession()
}
function clearPromptGroup(group: { fields: FieldDef[] }) {
  for (const f of group.fields) form[f.uid] = f.kind === 'number' ? 0 : ''
  scheduleFormSave()
}
// 粘贴剪贴板内容到「中」提示词
async function pastePromptGroup(group: { fields: FieldDef[] }) {
  try {
    const text = await navigator.clipboard.readText()
    if (!text || !text.trim()) { alert('剪贴板为空'); return }
    for (const f of group.fields) form[f.uid] = text.trim()
    scheduleFormSave()
  } catch {
    alert('无法读取剪贴板（浏览器权限限制），请直接在输入框内 Ctrl+V 粘贴')
  }
}
// 交换「中」提示词中的角色：小金毛 ↔ 小白（借占位符防止两次替换互相覆盖）
function swapPromptChars(group: { fields: FieldDef[] }) {
  const f = group.fields.find(x => x.kind === 'textarea')
  if (!f) return
  const cur = String(form[f.uid] ?? '')
  if (!cur.trim()) { toast.value = '提示词为空'; return }
  const swapped = cur.replaceAll('小金毛', '\u0000').replaceAll('小白', '小金毛').replaceAll('\u0000', '小白')
  if (swapped === cur) { toast.value = '提示词中没有「小金毛」或「小白」'; return }
  form[f.uid] = swapped
  scheduleFormSave()
  toast.value = '已交换：小金毛 ↔ 小白'
}

// ===== 批量生成（支持连续提交多批，互不阻塞）=====
const submitting = ref(false) // 仅在提交请求期间短暂锁定
const sessionBatches = ref<any[]>([]) // 本会话所有批次（最新在前）
const selectedBatchId = ref('') // 当前行选中的批次（用于「本批结果」区）
const runningCount = computed(() => sessionBatches.value.filter(b => !b.finishedAt && !b.cancelled).length)

function buildBaseOverrides() {
  const ov: Record<string,Record<string,any>> = {}
  for (const f of fields.value) {
    if (form[f.uid] !== f.original) {
      let v = form[f.uid]
      if (typeof f.original==='number' && f.kind==='number') v = Number(v)
      ;(ov[f.nodeId] ||= {})[f.name] = v
    }
  }
  return ov
}

async function submitBatch() {
  const valid = images.value.filter(i=>i.serverName)
  if (!valid.length) { alert('请先上传参考图'); return }
  if (!graph.value || submitting.value) return

  mgmt?.ensureAudio?.() // 用户手势期预热 AudioContext，完成音效才能正常出声
  submitting.value = true
  // 「每批自动随机」独立控制；一次性复用种子仅作用于本批第一单
  try {
    const res: any = await $fetch('/api/batch', {
      method:'POST',
      body:{
        workflow: selectedFile.value,
        clientId,
        images: valid.map(i=>i.serverName!),
        batch: batchCount.value||1,
        randSeed: autoRandSeed.value,
        fixedSeed: !autoRandSeed.value ? fixedSeedVal.value : null,
        firstSeed: pendingReuseSeed.value,
        baseOverrides: buildBaseOverrides()
      }
    })
    pendingReuseSeed.value = null // 一次性：已消费
    progress.status = ''
    sessionBatches.value.unshift(res)
    selectedBatchId.value = res.id
    saveBatches()
    ensurePolling()
    flashSubmitBtn()
  } catch(e:any){
    progress.status='error'
    progress.message = e?.data?.message || e?.data?.error?.message || e?.message || '批量启动失败'
  } finally {
    submitting.value = false // 立即解锁，可继续提交下一批
  }
}

// 全局轮询：同时盯住所有未完成批次
function ensurePolling() {
  if (pollTimer.value) return
  pollTimer.value = setInterval(pollAll, 1500)
}
// 提交成功 → 按钮绿色闪烁反馈（✓ 已开始生成）
const submitFlash = ref(false)
let submitFlashTimer: any = null
function flashSubmitBtn() {
  submitFlash.value = true
  if (submitFlashTimer) clearTimeout(submitFlashTimer)
  submitFlashTimer = setTimeout(() => { submitFlash.value = false }, 1200)
}
// 已刷新进最近产出的 promptId，用于识别「新完成的资产」并实时刷新
const seenDoneIds = new Set<string>()
function collectDoneIds(b: any): Set<string> {
  const s = new Set<string>()
  for (const it of (b?.items || [])) if (it.status === 'done' && it.promptId) s.add(it.promptId)
  return s
}
let pollBusy = false // 上一轮未返回时跳过本轮，避免请求堆积（ComfyUI 忙时 1.5s 间隔可能不够）
async function pollAll() {
  if (pollBusy) return
  const unfinished = sessionBatches.value.filter(b => !b.finishedAt && !b.cancelled)
  if (!unfinished.length) { stopPolling(); return }
  pollBusy = true
  let newlyDone = false
  try {
    for (const b of unfinished) {
      try {
        const info: any = await $fetch(`/api/batch/${b.id}`)
        if (info.exists === false) { b.finishedAt = b.finishedAt || Date.now(); continue }
        const before = collectDoneIds(b)
        Object.assign(b, info)
        // 新完成的单 → 立即刷新最近产出（不等整批结束）
        for (const id of collectDoneIds(b)) {
          if (!before.has(id) && !seenDoneIds.has(id)) { seenDoneIds.add(id); newlyDone = true }
        }
      } catch { /* 网络抖动忽略 */ }
    }
  } finally {
    pollBusy = false
  }
  if (newlyDone) refreshHistory()
  saveBatches() // 状态有推进就落 localStorage，刷新后批次列表不丢
  // 仅当全部批次都结束时才停轮询；还有未完成的必须继续盯（否则后面的批次永远卡在排队中）
  if (!sessionBatches.value.some(b => !b.finishedAt && !b.cancelled)) {
    stopPolling()
    // 本会话全部批次完成 → 播放提示音（loud：重复 3 遍，确保能及时发现）
    if (soundEnabled.value) playChime(true)
    else console.info('[chime] 全部批次已完成，但音效开关为关，跳过播放')
  }
}
function stopPolling() {
  if (pollTimer.value) { clearInterval(pollTimer.value); pollTimer.value = null }
  refreshHistory()
}
async function stopBatch(id: string) {
  try { await $fetch(`/api/batch/${id}`, { method: 'DELETE' }) } catch {}
  const b = sessionBatches.value.find(x => x.id === id)
  if (b) b.cancelled = true
  refreshHistory()
}

// ===== 派生 =====
const progress = reactive<{status:string; message:string}>({status:'', message:''})
const activeBatch = computed(() => sessionBatches.value.find(b => b.id === selectedBatchId.value) || null)
// 每行批次的状态文案 / 进度 / 工作流短名
function shortWf(file: string) {
  return String(file || '').replace(/\.json$/i, '')
}
function batchTextOf(b: any): string {
  const r = b?.items || []
  if (!b.finishedAt && !b.cancelled && !b.loopStarted) return `排队中 · 共 ${r.length} 单`
  const done = r.filter((i:any)=>i.status==='done').length
  const err = r.filter((i:any)=>i.status==='error').length
  const run = r.filter((i:any)=>i.status==='running').length
  return `${done}/${r.length}${run ? ` · ${run} 进行中` : ''}${err ? ` · ${err} 失败` : ''}`
}
function percentOf(b: any): number {
  const r = b?.items || []
  if (!r.length) return 0
  const done = r.filter((i:any)=>i.status==='done').length
  return Math.round(done / r.length * 100)
}
const batchDoneOutputs = computed<Out[]>(()=>{
  const list:Out[]=[]
  for (const item of (activeBatch.value?.items||[])) {
    if (item.status==='done') for (const o of item.outputs||[]) {
      list.push({ ...o, src: mediaUrl(o), durationMs: item.durationMs })
    }
  }
  return list
})

// ===== 历史 =====
// 已清空的历史记录（promptId 集合），刷新后仍保持隐藏；新产出 id 不同不受影响
const CLEARED_KEY = 'historyCleared:v1'
const clearedIds = new Set<string>(readJSON<string[]>(CLEARED_KEY))
function readJSON<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}
function saveCleared() {
  try { localStorage.setItem(CLEARED_KEY, JSON.stringify([...clearedIds].slice(-500))) } catch {}
}
// 历史刷新：脏标记 + 去抖合并 + 兜底重试。
// ComfyUI 忙时 /history 可能超时——失败不清脏标记，4s 兜底定时器会一直重试直到成功，绝不丢更新
let histDirty = false
let histInFlight = false
let histDebounce: any = null
function refreshHistory(force = false) {
  histDirty = true
  if (force) {
    if (histDebounce) { clearTimeout(histDebounce); histDebounce = null }
    flushHistory()
    return
  }
  if (histDebounce || histInFlight) return // 去抖：连续多次触发合并为一次拉取
  histDebounce = setTimeout(flushHistory, 600)
}
async function flushHistory() {
  histDebounce = null
  if (histInFlight || !histDirty) return
  histInFlight = true
  histDirty = false
  try {
    // max=100：窗口要足够大，避免新产出把旧产出挤出窗口导致「看起来没更新」
    const res: any = await $fetch('/api/history?max=100', { timeout: 12000 })
    history.value = (res.items || []).filter((it: any) => !clearedIds.has(it.promptId))
    // 首次使用（无已读记录）：把当前已有资产全部标为已读，之后的新产出才显示未读
    if (!readSeeded) { readSeeded = true; for (const it of history.value) readIds.add(it.promptId); saveRead() }
  } catch {
    histDirty = true // 拉取失败（网络抖动/ComfyUI 忙），保留脏标记等兜底重试
  } finally {
    histInFlight = false
  }
}
// 兜底心跳：只要有待刷新就每 4s 重试（含批次全部结束后的终态保障）
setInterval(() => { if (histDirty) flushHistory() }, 4000)
function clearHistory() {
  // 固定的资产不参与清空，保留在列表中
  for (const it of history.value) if (!isPinned(it)) clearedIds.add(it.promptId)
  saveCleared()
  history.value = history.value.filter(it => isPinned(it))
}
// 删除单个：与清空同机制（promptId 进隐藏集合），仅影响列表显示，不动服务器文件
function deleteHistoryItem(it: any) {
  clearedIds.add(it.promptId)
  saveCleared()
  history.value = history.value.filter(x => x.promptId !== it.promptId)
}
// 灯箱内删除：先关灯箱再删，避免 viewer 引用已移除的项
function deleteViewerItem() {
  if (!viewer.value?.item) return
  const it = viewer.value.item
  viewer.value = null
  deleteHistoryItem(it)
  showToast('已删除（仅从最近产出隐藏，服务器文件不受影响）')
}

// ===== 资产重命名：promptId → 自定义名称（localStorage 持久化），下载文件名随之 =====
const RENAME_KEY = 'assetRenames:v1'
const renames = reactive<Record<string, string>>(readJSON<Record<string, string>>(RENAME_KEY) || {})
function saveRenames() {
  try { localStorage.setItem(RENAME_KEY, JSON.stringify(renames)) } catch {}
}
function assetName(item: any): string { return renames[item.promptId] || '' }
function renameAsset(item: any) {
  const name = prompt('设置资产名称（下载文件名将使用该名称，留空清除）', renames[item.promptId] || '')
  if (name === null) return
  const t = name.trim()
  if (t) {
    renames[item.promptId] = t
    // 命名即视为重要资产：自动固定（清空最近产出时保留）
    if (!pinIds.has(item.promptId)) {
      pinIds.add(item.promptId)
      savePins()
      showToast(`已命名：${t}（并自动固定）`)
      return
    }
  }
  else delete renames[item.promptId]
  saveRenames()
  if (t) showToast(`已命名：${t}`)
}
/** 下载文件名：有自定义名称则用「名称.原扩展名」，否则原始文件名 */
function downloadName(item: any): string {
  const fn = String(item?.outputs?.[0]?.filename || '')
  const ext = fn.includes('.') ? fn.slice(fn.lastIndexOf('.')) : ''
  const custom = renames[item.promptId]
  return custom ? custom + ext : fn
}

// ===== 复制中提示词：优先取节点标题含「中」的文本，兜底取最长字符串提示词 =====
function midPromptOf(item: any): string {
  const titles = item?.promptTitles || {}
  const prompts = item?.prompts || {}
  const uid = Object.keys(prompts).find(u => typeof prompts[u] === 'string' && /中/.test(String(titles[u] || '')))
  if (uid) return prompts[uid]
  const texts = Object.values<any>(prompts).filter(v => typeof v === 'string') as string[]
  return texts.sort((a, b) => b.length - a.length)[0] || ''
}
async function copyMidPrompt(item: any) {
  const t = midPromptOf(item)
  if (!t) { showToast('该资产没有可复制的中提示词'); return }
  try { await navigator.clipboard.writeText(t); showToast('已复制中提示词') }
  catch { showToast('复制失败（浏览器权限限制）') }
}

// ===== 未读/已读：点击过卡片即已读（localStorage 持久化）=====
const READ_KEY = 'historyRead:v1'
const readExisted = (() => { try { return localStorage.getItem(READ_KEY) !== null } catch { return true } })()
let readSeeded = readExisted // 首次使用时把现有资产全部视为已读，避免满屏 NEW
const readIds = reactive(new Set<string>(readJSON<string[]>(READ_KEY) || []))
function saveRead() { try { localStorage.setItem(READ_KEY, JSON.stringify([...readIds].slice(-2000))) } catch {} }
function isRead(item: any) { return readIds.has(item.promptId) }
function markRead(item: any) { if (!readIds.has(item.promptId)) { readIds.add(item.promptId); saveRead() } }
function toggleRead(item: any) {
  if (readIds.has(item.promptId)) { readIds.delete(item.promptId); showToast('已标为未读') }
  else { readIds.add(item.promptId); showToast('已标为已读') }
  saveRead()
}

// ===== 固定：固定的资产在「清空最近产出」时保留，并排在列表最前（localStorage 持久化）=====
const PIN_KEY = 'historyPins:v1'
const pinIds = reactive(new Set<string>(readJSON<string[]>(PIN_KEY) || []))
function savePins() { try { localStorage.setItem(PIN_KEY, JSON.stringify([...pinIds].slice(-500))) } catch {} }
function isPinned(item: any) { return pinIds.has(item.promptId) }
function togglePin(item: any) {
  if (pinIds.has(item.promptId)) { pinIds.delete(item.promptId); showToast('已取消固定') }
  else { pinIds.add(item.promptId); showToast('已固定，清空最近产出时将保留') }
  savePins()
}
const historyView = computed(() => {
  const arr = [...history.value]
  arr.sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)))
  return arr
})

// ===== 右键菜单 =====
const ctxMenu = ref<{ x: number; y: number; item: any } | null>(null)
function openCtxMenu(e: MouseEvent, item: any) {
  const mw = 200, mh = 330
  ctxMenu.value = { x: Math.min(e.clientX, window.innerWidth - mw - 8), y: Math.min(e.clientY, window.innerHeight - mh - 8), item }
}
function ctxDo(fn: (item: any) => any) {
  const it = ctxMenu.value?.item
  ctxMenu.value = null
  if (it) fn(it)
}
function downloadItem(item: any) {
  const o = item?.outputs?.[0]
  if (!o) { showToast('该资产没有可下载的文件'); return }
  const a = document.createElement('a')
  a.href = mediaUrl(o); a.download = downloadName(item)
  document.body.appendChild(a); a.click(); a.remove()
}

// ===== 完成音效 / 管理菜单栏（引擎在 app.vue，这里注册页面级动作）=====
const mgmt = inject<any>('mgmt', null)
const soundEnabled = computed(() => mgmt?.soundEnabled?.value ?? false)
if (mgmt) {
  mgmt.mgmtActions.clearHistory = clearHistory
  mgmt.mgmtActions.clearBatches = clearBatches
  mgmt.mgmtActions.resetInputs = resetInputs
}
function clearBatches() {
  const running = runningCount.value
  if (running > 0 && !confirm(`还有 ${running} 个批次进行中，清空列表后将不再显示它们的进度（服务器上仍会继续生成并出现在最近产出）。确定清空？`)) return
  sessionBatches.value = []
  selectedBatchId.value = ''
  seenDoneIds.clear()
  saveBatches()
  stopPolling()
}
function resetInputs() {
  if (!confirm('清空参考图和全部提示词输入？（seed 等参数保持不变）')) return
  clearImages()
  for (const f of fields.value) {
    if (f.kind === 'textarea' || f.kind === 'text') form[f.uid] = ''
  }
  scheduleFormSave()
  showToast('已重置输入区')
}


// ===== 资产全参数复用 =====
// 读取资产提交时的完整工作流图（/api/asset-params）：自动匹配本地工作流 → 精确还原所有参数 + seed 复用中 + 参考图
const applyingParams = ref(false)
const toast = ref('')
let toastTimer: any = null
function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2800)
}
const wfGraphCache = new Map<string, any>()

async function applyAssetParams(item: any) {
  if (applyingParams.value) return
  applyingParams.value = true
  try {
    const res: any = await $fetch('/api/asset-params', { params: { promptId: item.promptId } })
    await applyGraph(res?.graph)
  } catch (e: any) {
    showToast(e?.data?.message || e?.message || '读取资产参数失败')
  } finally {
    applyingParams.value = false
  }
}

// 上传一个生成产物（图片/视频），按文件名在最近产出里反查对应资产并复用其全部参数
function onAssetFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (f) applyAssetFile(f)
}
// 拖拽资产文件到「从资产复用」按钮上直接复用
function onAssetDrop(e: DragEvent) {
  const f = e.dataTransfer?.files?.[0]
  if (f) applyAssetFile(f)
}
async function applyAssetFile(f: File) {
  if (applyingParams.value) return
  applyingParams.value = true
  try {
    // ① PNG 内嵌元数据（ComfyUI 生成时把提交图写进 PNG tEXt 块）：任意机器生成均可解析，与服务器无关
    if (/\.png$/i.test(f.name) || f.type === 'image/png') {
      const g = await extractPngPromptGraph(f)
      if (g) { await applyGraph(g); return }
    }
    // ② 自定义命名（下载/改名后的文件与服务器原始文件名不同）③ 当前历史文件名 ④ Comfy API 按文件名兜底
    const base = stripQuery(f.name)
    let promptId = ''
    for (const [pid, name] of Object.entries(renames)) {
      if (name && stripQuery(name) === base) { promptId = pid; break }
    }
    if (!promptId) {
      const hit = history.value.find(it => it.outputs[0] && stripQuery(String(it.outputs[0].filename || '')) === base)
      if (hit) promptId = hit.promptId
    }
    if (promptId) {
      const res: any = await $fetch('/api/asset-params', { params: { promptId } })
      await applyGraph(res?.graph)
      return
    }
    const res: any = await $fetch('/api/asset-params', { params: { filename: f.name } })
    await applyGraph(res?.graph)
  } catch (e: any) {
    showToast(e?.data?.message || e?.message || '读取资产参数失败')
  } finally {
    applyingParams.value = false
  }
}
// 解析 PNG 的 tEXt 块，取 ComfyUI 内嵌的「prompt」（API 格式提交图）——与 ComfyUI 前端拖入加载工作流同源
async function extractPngPromptGraph(f: File): Promise<any | null> {
  try {
    const buf = new Uint8Array(await f.arrayBuffer())
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    let off = 8
    while (off + 8 <= buf.length) {
      const len = dv.getUint32(off)
      const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7])
      if (type === 'tEXt' && len > 0) {
        const data = buf.subarray(off + 8, off + 8 + len)
        const z = data.indexOf(0)
        if (z > 0 && new TextDecoder('latin1').decode(data.subarray(0, z)) === 'prompt') {
          // 正文是 UTF-8 编码的 JSON（中文提示词必须按 UTF-8 解码，latin1 会损坏）
          try { return JSON.parse(new TextDecoder('utf-8').decode(data.subarray(z + 1))) } catch { return null }
        }
      }
      if (type === 'IEND') break
      off += 12 + len
    }
  } catch { /* 非 PNG 或读取失败 → 走反查链 */ }
  return null
}
// 去扩展名 + 去浏览器重复下载的「 (1)」后缀，统一小写便于比对
function stripQuery(s: string): string {
  return s.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)$/, '').trim().toLowerCase()
}

// 核心：应用一份提交时的工作流图
async function applyGraph(g: any) {
  if (!g || !Object.keys(g).length) { showToast('该资产没有可读取的提交参数'); return }
  // ① 自动匹配最相似的本地工作流（按 节点ID+class_type 重合度打分），必要时自动切换
  let best: { file: string; score: number } | null = null
  for (const w of workflows.value.filter(x => !x.broken)) {
    let wg: any = wfGraphCache.get(w.file)
    if (!wg) {
      try { wg = await $fetch(`/api/workflows/${encodeURIComponent(w.file)}`); wfGraphCache.set(w.file, wg) }
      catch { continue }
    }
    let score = 0
    for (const [nid, node] of Object.entries<any>(g)) {
      if (wg?.[nid]?.class_type === node?.class_type) score++
    }
    if (!best || score > best.score) best = { file: w.file, score }
  }
  const total = Object.keys(g).length
  if (best && best.file !== selectedFile.value && best.score >= total * 0.5) {
    const wf = workflows.value.find(w => w.file === best!.file)
    if (wf) { await selectWorkflow(wf); showToast(`已切换到该资产的工作流：${wf.name}`) }
  }

  // ② 按「节点ID.字段名」精确还原所有参数（提示词/分辨率/时长/LoRA/强度等一切输入）
  let n = 0
  for (const f of fields.value) {
    const v = g?.[f.nodeId]?.inputs?.[f.name]
    if (v === undefined || v === null || Array.isArray(v)) continue
    form[f.uid] = v
    n++
  }
  // ③ seed 复用：记为一次性种子（下一批的第一单使用一次），不动「每批自动随机」勾选
  const sf = seedField.value
  if (sf) {
    const sv = g?.[sf.nodeId]?.inputs?.[sf.name]
    if (typeof sv === 'number') { fixedSeedVal.value = sv; pendingReuseSeed.value = sv; n++ }
  }
  // ④ 还原参考图：LoadImage 按标题自然排序（与后端槽位顺序一致），src 走 /api/view 代理
  const loadNodes = Object.entries<any>(g)
    .filter(([, node]) => node?.class_type === 'LoadImage' && typeof node?.inputs?.image === 'string')
    .sort((a, b) => String(a[1]?._meta?.title || '').localeCompare(String(b[1]?._meta?.title || ''), 'zh-Hans-CN', { numeric: true }))
  const restored: QueuedImg[] = loadNodes.map(([nid, node]) => {
    const raw = String(node.inputs.image)
    const idx = raw.lastIndexOf('/')
    const filename = idx >= 0 ? raw.slice(idx + 1) : raw
    const subfolder = idx >= 0 ? raw.slice(0, idx) : ''
    const q = new URLSearchParams({ filename, type: 'input' })
    if (subfolder) q.set('subfolder', subfolder)
    return { id: `${nid}-${Date.now().toString(36)}`, name: filename, src: `/api/view?${q}`, serverName: raw }
  })
  if (restored.length) images.value = restored
  saveSession()
  showToast(`✅ 已复用该资产全部参数：${n} 项参数${restored.length ? ` + ${restored.length} 张参考图` : ''}`)
}

// ===== 大图预览 =====
// 网格视频悬停即播（静音循环），移开暂停复位——快速扫览对比挑选
function hoverPlay(e: Event) {
  const v = e.target as HTMLVideoElement
  try { v.currentTime = 0 } catch {}
  v.muted = true
  v.play().catch(() => {})
}
function hoverPause(e: Event) {
  ;(e.target as HTMLVideoElement).pause()
}
const viewer = ref<{ src: string; filename: string; kind: 'image' | 'video'; item: any | null } | null>(null)
function openViewer(src: string, filename: string, kind: 'image' | 'video' = 'image', item: any = null) {
  viewer.value = { src, filename, kind, item }
}
// 灯箱导航：在最近产出列表（与卡片显示同序）中翻上一个/下一个
function viewerIndex(): number {
  if (!viewer.value?.item) return -1
  return historyView.value.findIndex(it => it.promptId === viewer.value!.item.promptId)
}
function navViewer(dir: 1 | -1) {
  const arr = historyView.value
  if (!arr.length) return
  let i = viewerIndex()
  if (i === -1) i = dir === 1 ? -1 : 0
  const next = arr[(i + dir + arr.length) % arr.length]
  const out = next.outputs[0]
  if (!out) return
  markRead(next)
  viewer.value = { src: mediaUrl(out), filename: out.filename, kind: out.kind, item: next }
}
async function copyText(t: string, okMsg = '已复制') {
  if (!t) { showToast('没有可复制的内容'); return }
  try { await navigator.clipboard.writeText(t); showToast(okMsg) }
  catch { showToast('复制失败（浏览器权限限制）') }
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { viewer.value = null; return }
  // 灯箱打开时：←/→ 翻上一个/下一个资产
  if (viewer.value?.item && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault()
    navViewer(e.key === 'ArrowRight' ? 1 : -1)
    return
  }
  // Ctrl/Cmd+Enter：开始批量生成（提示词输入框内也可触发）
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    if (!submitting.value && canSubmit.value) submitBatch()
    return
  }
  // R：刷新最近产出（仅在非输入焦点时生效，避免打字冲突）
  if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const t = e.target as HTMLElement | null
    const tag = t?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
    e.preventDefault()
    refreshHistory(true)
  }
}

// ===== 生成计划提示 =====
// 图片槽位数：工作流里 LoadImage 节点数（多槽位=每单消耗一组图）
const imageSlots = computed(() => Object.values<any>(graph.value || {}).filter(n => n?.class_type === 'LoadImage').length)
const validImageCount = computed(() => images.value.filter(i => i.serverName).length)
const canSubmit = computed(() => {
  if (!graph.value) return false
  return validImageCount.value > 0
})
const planText = computed(() => {
  if (!graph.value) return '请先在左侧选择工作流'
  const slots = imageSlots.value
  const n = validImageCount.value
  if (!n) return '请先上传参考图'
  const batch = batchCount.value || 1
  if (slots > 1) {
    const groups = Math.ceil(n / slots)
    const last = n - (groups - 1) * slots
    const per = groups === 1
      ? `启用 Picture 1→${last}，共 ${last} 张`
      : `每组最多 ${slots} 张（末组 ${last} 张）`
    return `将生成 ${groups * batch} 个（${groups} 组 × ${batch} 批）· ${per}`
  }
  return `将生成 ${n * batch} 个（${n} 张参考图 × ${batch} 批）`
})
function mediaUrl(r:any, bust=false) {
  const q = new URLSearchParams({ filename:r.filename, subfolder:r.subfolder||'', type:r.type||'output' })
  if (bust) q.append('cache','0')
  return `/api/view?${q.toString()}`
}
function runningOnWorkflow(file:string){
  return sessionBatches.value.some(b => b.workflow === file && !b.finishedAt && !b.cancelled)
}

// ===== 启动 =====
// 刷新保留：图片队列变动立即存，提示词防抖存
watch(images, () => { if (selectedFile.value) saveSession() }, { deep: true })
watch(form, () => scheduleFormSave(), { deep: true })

// 生成设置（批次/随机开关/固定seed）跨刷新保留
const GEN_KEY = 'genSettings:v1'
watch([batchCount, autoRandSeed, fixedSeedVal], () => {
  try { localStorage.setItem(GEN_KEY, JSON.stringify({ batchCount: batchCount.value, autoRandSeed: autoRandSeed.value, fixedSeedVal: fixedSeedVal.value })) } catch {}
})
function loadGenSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(GEN_KEY) || 'null')
    if (!s) return
    if (typeof s.batchCount === 'number' && s.batchCount >= 1) batchCount.value = s.batchCount
    if (typeof s.autoRandSeed === 'boolean') autoRandSeed.value = s.autoRandSeed
    if (typeof s.fixedSeedVal === 'number') fixedSeedVal.value = s.fixedSeedVal
  } catch {}
}

onMounted(() => {
  loadGenSettings()
  loadWorkflows()
  loadPersistedBatches()
  refreshHistory()
  $fetch('/api/loras').then((r: any) => { loraOptions.value = r?.loras || [] }).catch(() => {})
  window.addEventListener('keydown', onKeydown)
  // 后台标签页的定时器会被浏览器节流，切回前台时立即补一次状态+历史刷新
  document.addEventListener('visibilitychange', onVisibility)
})
function onVisibility() {
  if (document.hidden) return
  if (sessionBatches.value.some(b => !b.finishedAt && !b.cancelled)) pollAll()
  refreshHistory(true)
}
// 浏览器标签页标题反映任务进行状态（切到别的标签页也能瞄到进度）
watch(runningCount, (n) => {
  // 归零时有真正跑完（非全部手动取消）的批次 → 标题标记完成，方便切走时发现
  const allDone = n === 0 && sessionBatches.value.some(b => b.finishedAt && !b.cancelled)
  document.title = n > 0 ? `▶ ${n} 个批次进行中 · ComfyUI Studio` : (allDone ? '✅ 全部完成 · ComfyUI Studio' : 'ComfyUI Studio')
}, { immediate: true })
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

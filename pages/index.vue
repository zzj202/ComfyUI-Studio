<template>
  <div class="layout">
    <main class="cols">
      <!-- 左栏：参数输入 -->
      <div class="col col-input">
      <!-- ⓪ 工作流选择 -->
      <div class="wf-bar card">
        <div class="wf-bar-title">📂 工作流</div>
        <div class="wf-chips">
          <div
            v-for="wf in workflows"
            :key="wf.file"
            class="wf-chip"
            :class="{ active: wf.file === selectedFile, broken: wf.broken }"
            @click="selectWorkflow(wf)"
          >
            <span class="wf-name">{{ wf.name }}</span>
            <span class="wf-meta">
              <template v-if="runningOnWorkflow(wf.file)">● 批量进行中</template>
              <template v-else-if="wf.broken">JSON 解析失败</template>
              <template v-else>{{ wf.nodeCount }} 节点</template>
            </span>
          </div>
          <span v-if="workflows.length === 0" class="empty" style="padding:0">暂无工作流</span>
        </div>
      </div>

      <!-- ① 参考图队列 -->
      <div class="card">
        <h2>
          🖼 参考图（{{ images.length }}）
          <button class="btn mini" style="margin-left:auto" title="上传一个生成产物（图片/视频），按文件名反查其提交参数并一键复用全部参数" @click="($refs.assetFileInput as any)?.click()">♻️ 从资产复用</button>
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

      <!-- ② 常用参数 & 高级参数 & 提示词 & 生成设置 -->
      <div class="card">
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

        <!-- 提示词区（在高级参数下方）：首/尾一行，中独占一行 -->
        <template v-for="(row, ri) in promptRows" :key="'pr'+ri">
          <div :class="['prompt-row', { multi: row.length > 1 }]">
            <div v-for="group in row" :key="group.nodeId" class="node-group">
              <div class="group-title row">
                <span>✏️ {{ group.title }}</span>
                <button v-if="group.title.includes('中')" class="btn mini" title="把剪贴板内容粘贴到「中」提示词" @click="pastePromptGroup(group)">📋 粘贴</button>
                <button class="btn mini danger" @click="clearPromptGroup(group)">清空</button>
              </div>
              <div v-for="f in group.fields" :key="f.uid" class="field">
                <FieldControl :field="f" v-model="form[f.uid]" :hide-label="group.fields.length === 1 && group.fields[0].label === group.title" />
              </div>
            </div>
          </div>
        </template>

        <!-- 生成控制 -->
        <div class="gen-options">
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
              <div v-else-if="seedReuseActive" class="seed-reuse" style="margin-top:6px">
                🌱 复用中 seed：<b>{{ fixedSeedVal }}</b>（本批结束后恢复自动随机）
              </div>
            </div>
          </div>

          <div class="gen-actions">
            <span class="plan" :class="{ warn: !canSubmit }">{{ planText }}</span>
            <button class="btn primary" :disabled="submitting || !canSubmit" title="快捷键：Ctrl+Enter" @click="submitBatch">▶ 开始批量生成 <kbd class="kbd-hint">Ctrl+↵</kbd></button>
          </div>
        </div>

        <!-- 批次列表：可连续提交多批，互不阻塞 -->
        <div v-if="sessionBatches.length" class="batch-list">
          <div class="batch-list-title">📋 本会话批次（{{ runningCount }} 进行中 · 点击行查看结果）</div>
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
        <div v-if="progress.status === 'error'" class="status-line error" style="margin-top:8px">{{ progress.message }}</div>
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

      <!-- ④ 最近产出 -->
      <div class="card history-card">
        <h2>
          🗂 最近产出（{{ history.length }}）
          <button class="btn mini" title="快捷键：R（非输入状态）" @click="refreshHistory(true)" style="margin-left:auto">刷新 <kbd class="kbd-hint">R</kbd></button>
        </h2>
        <div v-if="history.length === 0" class="empty">暂无历史产出</div>
        <div v-else class="grid">
          <div v-for="item in history" :key="item.promptId" class="result-item">
            <div class="result-media">
              <template v-if="item.outputs.length">
                <img v-if="item.outputs[0].kind === 'image'" :src="mediaUrl(item.outputs[0])" loading="lazy" @click="openViewer(mediaUrl(item.outputs[0]), item.outputs[0].filename, 'image')" />
                <video v-else-if="item.outputs[0].kind === 'video'" :src="mediaUrl(item.outputs[0])" muted loop playsinline preload="metadata" @mouseenter="hoverPlay" @mouseleave="hoverPause" @click="openViewer(mediaUrl(item.outputs[0]), item.outputs[0].filename, 'video')" />
              </template>
            </div>
            <div v-if="promptText(item)" class="result-prompt" :title="promptText(item)">{{ promptText(item) }}</div>
            <div class="result-foot">
              <button class="btn mini" title="读取该资产提交时的完整工作流：自动匹配工作流，还原所有参数（提示词/seed/分辨率/时长/LoRA）与参考图" @click="applyAssetParams(item)">♻️ 复用全部参数</button>
              <span v-if="fmtDur(item.durationMs)" class="time-chip" title="生成耗时">⏱ {{ fmtDur(item.durationMs) }}</span>
              <span class="fn" :title="item.promptId">{{ item.outputs.length }} 个 · {{ item.promptId.slice(0, 8) }}…</span>
              <a v-if="item.outputs[0]" class="btn mini" :href="mediaUrl(item.outputs[0])" :download="item.outputs[0].filename">下载</a>
            </div>
          </div>
        </div>
      </div>
      </div>
    </main>

    <!-- 轻提示 -->
    <div v-if="toast" style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e2235;color:#fff;padding:10px 20px;border-radius:12px;font-size:13px;z-index:200;box-shadow:0 8px 30px rgba(0,0,0,.25);pointer-events:none">{{ toast }}</div>

    <!-- 大图预览灯箱 -->
    <div v-if="viewer" class="lightbox" @click.self="viewer = null">
      <button class="lb-x" title="关闭" @click="viewer = null">✕</button>
      <img v-if="viewer.kind === 'image'" :src="viewer.src" :alt="viewer.filename" />
      <video v-else :src="viewer.src" controls autoplay loop></video>
      <div class="lb-bar">
        <span class="fn">{{ viewer.filename }}</span>
        <a class="btn small" :href="viewer.src" :download="viewer.filename">⬇ 下载原图</a>
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
      if (typeof value === 'number') { kind = 'number'; isSeed = /seed/i.test(name); if (!isSeed) step = Number.isInteger(value) ? 1 : 0.01 }
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
  // 复用中：这批固定用复用的 seed；否则按勾选的随机模式
  const useFixed = seedReuseActive.value || !autoRandSeed.value
  try {
    const res: any = await $fetch('/api/batch', {
      method:'POST',
      body:{
        workflow: selectedFile.value,
        clientId,
        images: valid.map(i=>i.serverName!),
        batch: batchCount.value||1,
        randSeed: !useFixed,
        fixedSeed: useFixed ? fixedSeedVal.value : null,
        baseOverrides: buildBaseOverrides()
      }
    })
    progress.status = ''
    sessionBatches.value.unshift(res)
    selectedBatchId.value = res.id
    ensurePolling()
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
        if (info.finishedAt) maybeRestoreSeed()
      } catch { /* 网络抖动忽略 */ }
    }
  } finally {
    pollBusy = false
  }
  if (newlyDone) refreshHistory()
  // 仅当全部批次都结束时才停轮询；还有未完成的必须继续盯（否则后面的批次永远卡在排队中）
  if (!sessionBatches.value.some(b => !b.finishedAt && !b.cancelled)) {
    stopPolling()
    // 本会话最后一个批次完成 → 播放提示音
    if (soundEnabled.value) playChime()
  }
}
function stopPolling() {
  if (pollTimer.value) { clearInterval(pollTimer.value); pollTimer.value = null }
  maybeRestoreSeed()
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
  } catch {
    histDirty = true // 拉取失败（网络抖动/ComfyUI 忙），保留脏标记等兜底重试
  } finally {
    histInFlight = false
  }
}
// 兜底心跳：只要有待刷新就每 4s 重试（含批次全部结束后的终态保障）
setInterval(() => { if (histDirty) flushHistory() }, 4000)
function clearHistory() {
  for (const it of history.value) clearedIds.add(it.promptId)
  saveCleared()
  history.value = []
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
// 资产提示词摘要展示（仅文本）
function promptText(item: any): string {
  return Object.entries<any>(item?.prompts || {})
    .filter(([, v]) => typeof v === 'string')
    .map(([, v]) => v)
    .join(' / ')
}
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
async function onAssetFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f || applyingParams.value) return
  applyingParams.value = true
  try {
    const res: any = await $fetch('/api/asset-params', { params: { filename: f.name } })
    await applyGraph(res?.graph)
  } catch (e: any) {
    showToast(e?.data?.message || e?.message || '读取资产参数失败')
  } finally {
    applyingParams.value = false
  }
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
  // ③ seed 进入「复用中」：本批固定该 seed，本会话批次全部结束后自动恢复随机
  const sf = seedField.value
  if (sf) {
    const sv = g?.[sf.nodeId]?.inputs?.[sf.name]
    if (typeof sv === 'number') { fixedSeedVal.value = sv; seedReuseActive.value = true; n++ }
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
// 复用中状态：批次全部结束后恢复随机
const seedReuseActive = ref(false)
function maybeRestoreSeed() {
  const hasUnfinished = sessionBatches.value.some(b => !b.finishedAt && !b.cancelled)
  if (!hasUnfinished) seedReuseActive.value = false
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
const viewer = ref<{ src: string; filename: string; kind: 'image' | 'video' } | null>(null)
function openViewer(src: string, filename: string, kind: 'image' | 'video' = 'image') {
  viewer.value = { src, filename, kind }
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { viewer.value = null; return }
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
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

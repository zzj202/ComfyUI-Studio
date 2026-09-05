<template>
  <div class="layout">
    <!-- 侧栏：工作流列表 -->
    <aside class="side">
      <div class="card">
        <h2>📂 工作流</h2>
        <div v-if="workflows.length === 0" class="empty">暂无工作流</div>
        <div
          v-for="wf in workflows"
          :key="wf.file"
          class="wf-item"
          :class="{ active: wf.file === selectedFile }"
          @click="selectWorkflow(wf)"
        >
          <div class="wf-name">{{ wf.name }}</div>
          <div class="wf-meta">
            {{ wf.nodeCount }} 个节点
            <span v-if="runningOnWorkflow(wf.file)" class="wf-badge">● 批量进行中</span>
            <template v-else-if="wf.broken"> · JSON 解析失败</template>
          </div>
        </div>
      </div>
      <div class="hint">
        把 ComfyUI 导出(API) 的 json 放进 <code>server/workflows/</code> 即出现在左侧。多张参考图可拖拽排序，将<b>逐张×批次</b>自动连发。
      </div>
    </aside>

    <main>
      <!-- ① 参考图队列 -->
      <div class="card">
        <h2>
          🖼 参考图（{{ images.length }}）
          <button v-if="images.length" class="btn mini danger" @click="clearImages" style="margin-left:auto">清空</button>
        </h2>
        <div v-if="!selectedFile" class="empty">← 先在左侧选择一个工作流</div>
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
              <template v-if="isVideoWf"> · 本工作流每单按 {{ imageSlots }} 张一组使用（Picture 1 → 2 → 3 顺序）</template>
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
                <span v-if="batchIndex.includes(idx)" class="img-idx">{{ batchIndex.indexOf(idx) + 1 }}</span>
              </div>
              <div class="img-name" :title="img.name">{{ img.name }}</div>
            </div>
          </div>
        </template>
      </div>

      <!-- ② 提示词 & 常用参数 & 高级参数 & 生成设置 -->
      <div class="card">
        <template v-for="(row, ri) in promptRows" :key="'pr'+ri">
          <div :class="['prompt-row', { multi: row.length > 1 }]">
            <div v-for="group in row" :key="group.nodeId" class="node-group">
              <div class="group-title row">
                <span>✏️ {{ group.title }}</span>
                <button class="btn mini danger" @click="clearPromptGroup(group)">清空</button>
              </div>
              <div v-for="f in group.fields" :key="f.uid" class="field">
                <FieldControl :field="f" v-model="form[f.uid]" :hide-label="group.fields.length === 1 && group.fields[0].label === group.title" />
              </div>
            </div>
          </div>
        </template>

        <!-- 常用参数（常驻展示） -->
        <div v-if="commonFields.length" class="node-group common">
          <div class="group-title">🎛 常用参数</div>
          <div v-for="f in commonFields" :key="f.uid" class="field">
            <FieldControl :field="f" v-model="form[f.uid]" />
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
            </div>
          </div>

          <div class="gen-actions">
            <span class="plan" :class="{ warn: !canSubmit }">{{ planText }}</span>
            <button class="btn primary" :disabled="submitting || !canSubmit" @click="submitBatch">▶ 开始批量生成</button>
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

      <!-- ③ 本批结果 -->
      <div class="card" v-if="batchDoneOutputs.length">
        <h2>✨ 本次批量结果（{{ batchDoneOutputs.length }}）</h2>
        <div class="grid">
          <div v-for="(r, i) in batchDoneOutputs" :key="i" class="result-item">
            <div class="result-media">
              <img v-if="r.kind === 'image'" :src="r.src" loading="lazy" @click="openViewer(r.src, r.filename, 'image')" />
              <video v-else-if="r.kind === 'video'" :src="r.src" controls preload="metadata" />
              <div v-else class="muted" style="padding:12px">不支持预览</div>
            </div>
            <div class="result-foot">
              <span class="fn" :title="r.filename">{{ r.filename }}</span>
              <a class="btn mini" :href="r.src" :download="r.filename">下载</a>
            </div>
          </div>
        </div>
      </div>

      <!-- ④ 最近产出 -->
      <div class="card">
        <h2>
          🗂 最近产出（{{ history.length }}）
          <button class="btn mini" @click="refreshHistory" style="margin-left:auto">刷新</button>
          <button class="btn mini danger" @click="clearHistory">一键清空</button>
        </h2>
        <div v-if="history.length === 0" class="empty">暂无历史产出</div>
        <div v-else class="grid">
          <div v-for="item in history" :key="item.promptId" class="result-item">
            <div class="result-media">
              <template v-if="item.outputs.length">
                <img v-if="item.outputs[0].kind === 'image'" :src="mediaUrl(item.outputs[0], true)" loading="lazy" @click="openViewer(mediaUrl(item.outputs[0], true), item.outputs[0].filename, 'image')" />
                <video v-else-if="item.outputs[0].kind === 'video'" :src="mediaUrl(item.outputs[0], true)" controls preload="metadata" />
              </template>
            </div>
            <div v-if="promptText(item)" class="result-prompt" :title="promptText(item)">{{ promptText(item) }}</div>
            <div class="result-foot">
              <button v-if="hasPrompts(item)" class="btn mini" title="将这条记录的提示词与 seed 一键填回上方输入框" @click="applyPrompt(item)">🔁 复用提示词+Seed</button>
              <span class="fn" :title="item.promptId">{{ item.outputs.length }} 个 · {{ item.promptId.slice(0, 8) }}…</span>
              <a v-if="item.outputs[0]" class="btn mini" :href="mediaUrl(item.outputs[0], true)" :download="item.outputs[0].filename">下载</a>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 大图预览灯箱 -->
    <div v-if="viewer" class="lightbox" @click.self="viewer = null">
      <button class="lb-x" title="关闭" @click="viewer = null">✕</button>
      <img v-if="viewer.kind === 'image'" :src="viewer.src" :alt="viewer.filename" />
      <video v-else :src="viewer.src" controls autoplay></video>
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
interface Out { kind: string; filename: string; subfolder: string; type: string; src: string }

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
        if (name === 'sampler_name') { kind='select'; options=SAMPLERS }
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

// 一键清空：参考图 / 提示词
function clearImages() {
  images.value = []
  saveSession()
}
function clearPromptGroup(group: { fields: FieldDef[] }) {
  for (const f of group.fields) form[f.uid] = f.kind === 'number' ? 0 : ''
  scheduleFormSave()
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

  submitting.value = true
  try {
    const res: any = await $fetch('/api/batch', {
      method:'POST',
      body:{
        workflow: selectedFile.value,
        clientId,
        images: valid.map(i=>i.serverName!),
        batch: batchCount.value||1,
        randSeed: autoRandSeed.value,
        fixedSeed: autoRandSeed.value ? null : fixedSeedVal.value,
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
async function pollAll() {
  const unfinished = sessionBatches.value.filter(b => !b.finishedAt && !b.cancelled)
  if (!unfinished.length) { stopPolling(); return }
  for (const b of unfinished) {
    try {
      const info: any = await $fetch(`/api/batch/${b.id}`)
      if (info.exists === false) { b.finishedAt = b.finishedAt || Date.now(); continue }
      Object.assign(b, info)
      if (info.finishedAt) { maybeRestoreSeed(); refreshHistory() }
    } catch { /* 网络抖动忽略 */ }
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
      list.push({ ...o, src: mediaUrl(o, true) })
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
async function refreshHistory() {
  try {
    const res:any = await $fetch('/api/history?max=30')
    history.value = (res.items||[]).filter((it:any) => !clearedIds.has(it.promptId))
  }
  catch { /* 连接失败静默 */ }
}
function clearHistory() {
  for (const it of history.value) clearedIds.add(it.promptId)
  saveCleared()
  history.value = []
}
// 历史提示词：摘要展示（仅文本）+ 一键复用（文本+seed）
function promptText(item: any): string {
  return Object.entries<any>(item?.prompts || {})
    .filter(([, v]) => typeof v === 'string')
    .map(([, v]) => v)
    .join(' / ')
}
function hasPrompts(item: any): boolean {
  return !!item?.prompts && Object.keys(item.prompts).length > 0
}
function applyPrompt(item: any) {
  const prompts = item?.prompts || {}
  // 按输入名分组历史值：文本池 + seed
  const textsByName: Record<string, string[]> = {}
  let seedVal: number | null = null
  for (const [k, v] of Object.entries<any>(prompts)) {
    const name = k.split('.').pop() || ''
    if (typeof v === 'string' && v.trim()) (textsByName[name] ||= []).push(v)
    else if (typeof v === 'number' && /seed/i.test(name)) seedVal = v
  }
  let n = 0
  // 文本：按输入名匹配当前工作流的同名字段（textarea 优先），多值按字段顺序依次填
  for (const [name, vals] of Object.entries(textsByName)) {
    const targets = fields.value.filter(f => f.name === name && (f.kind === 'textarea' || f.kind === 'text'))
    targets.forEach((f, i) => { if (i < vals.length) { form[f.uid] = vals[i]; n++ } })
  }
  // 兜底：没有同名字段时，把第一条文本填进第一个提示词框
  if (!n) {
    const firstTextarea = fields.value.find(f => f.kind === 'textarea')
    const firstText = Object.values<any>(prompts).find(v => typeof v === 'string' && v.trim())
    if (firstTextarea && firstText) { form[firstTextarea.uid] = firstText; n++ }
  }
  // seed：填入当前工作流的 seed 字段，并切到固定 seed 模式（否则随机开关会覆盖它）
  // 一次性复用：本批跑完自动切回「每单自动随机」
  if (seedVal != null && seedField.value) {
    form[seedField.value.uid] = seedVal
    autoRandSeed.value = false
    fixedSeedVal.value = seedVal
    oneShotSeed = true
    n++
  }
  if (n) scheduleFormSave()
}
// 一次性 seed 复用：批次结束后恢复自动随机
let oneShotSeed = false
function maybeRestoreSeed() {
  if (oneShotSeed) { oneShotSeed = false; autoRandSeed.value = true }
}

// ===== 大图预览 =====
const viewer = ref<{ src: string; filename: string; kind: 'image' | 'video' } | null>(null)
function openViewer(src: string, filename: string, kind: 'image' | 'video' = 'image') {
  viewer.value = { src, filename, kind }
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') viewer.value = null
}

// ===== 生成计划提示 =====
// 图片槽位数：工作流里 LoadImage 节点数（多槽位=每单消耗一组图）
const imageSlots = computed(() => Object.values<any>(graph.value || {}).filter(n => n?.class_type === 'LoadImage').length)
const validImageCount = computed(() => images.value.filter(i => i.serverName).length)
const canSubmit = computed(() => {
  if (!graph.value) return false
  const n = validImageCount.value
  return imageSlots.value > 1 ? n >= imageSlots.value : n > 0
})
const planText = computed(() => {
  if (!graph.value) return '请先在左侧选择工作流'
  const slots = imageSlots.value
  const n = validImageCount.value
  if (!n) return '请先上传参考图'
  const batch = batchCount.value || 1
  if (slots > 1) {
    if (n < slots) return `该工作流每单需要 ${slots} 张参考图（一组），还差 ${slots - n} 张`
    const groups = Math.floor(n / slots)
    const leftover = n % slots
    return `将生成 ${groups * batch} 个（${groups} 组 × ${batch} 批，每组 ${slots} 张图）${leftover ? `，多出的 ${leftover} 张不参与` : ''}`
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
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

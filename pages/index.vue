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
            <div class="dz-hint">📤 点击 或 拖拽图片到此处（可多选）</div>
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

      <!-- ② 提示词 & 高级参数 & 生成设置 -->
      <div class="card">
        <div v-for="group in promptGroups" :key="group.nodeId" class="node-group">
          <div class="group-title row">
            <span>✏️ {{ group.title }}</span>
            <button class="btn mini danger" @click="clearPromptGroup(group)">清空</button>
          </div>
          <div v-for="f in group.fields" :key="f.uid" class="field">
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
          <div class="field">
            <label>批次（每张图跑几单）</label>
            <div class="seed-row">
              <input type="number" min="1" max="50" v-model.number="batchCount" />
              <button class="btn small" :disabled="busy" @click="submitBatch">▶ 开始批量生成</button>
              <button v-if="activeBatch" class="btn small danger" :disabled="!activeBatch" @click="stopBatch">⏹ 停止</button>
            </div>
            <div class="quick-row">
              <span class="muted" style="font-size:12px">快速选择：</span>
              <button v-for="n in [1,2,3,4]" :key="n" class="btn quick" :class="{ on: batchCount===n }" @click="batchCount=n">{{ n }}</button>
            </div>
          </div>

          <div class="field">
            <label class="inline-label">
              <input type="checkbox" v-model="autoRandSeed" />
              每单自动随机 seed
            </label>
            <div v-if="!autoRandSeed && seedValue != null" class="field" style="margin-top:6px">
              <label>固定 seed（复现用）</label>
              <input type="number" v-model.number="fixedSeedVal" />
            </div>
          </div>
        </div>

        <div v-if="progress.status" style="margin-top:16px">
          <div class="progress-wrap">
            <div class="progress-track">
              <div class="progress-bar" :style="{ width: batchPercent + '%' }"></div>
            </div>
            <div class="progress-text">{{ batchText }}</div>
          </div>
          <div class="status-line" :class="{ error: progress.status === 'error' }">{{ progressMessage }}</div>
        </div>
      </div>

      <!-- ③ 本批结果 -->
      <div class="card" v-if="batchDoneOutputs.length">
        <h2>✨ 本次批量结果（{{ batchDoneOutputs.length }}）</h2>
        <div class="grid">
          <div v-for="(r, i) in batchDoneOutputs" :key="i" class="result-item">
            <div class="result-media">
              <img v-if="r.kind === 'image'" :src="r.src" loading="lazy" />
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
                <img v-if="item.outputs[0].kind === 'image'" :src="mediaUrl(item.outputs[0], true)" loading="lazy" />
                <video v-else-if="item.outputs[0].kind === 'video'" :src="mediaUrl(item.outputs[0], true)" controls preload="metadata" />
              </template>
            </div>
            <div v-if="promptText(item)" class="result-prompt" :title="promptText(item)">{{ promptText(item) }}</div>
            <div class="result-foot">
              <button v-if="hasPrompts(item)" class="btn mini" title="将这条记录的提示词填回上方输入框" @click="applyPrompt(item)">🔁 复用提示词</button>
              <span class="fn" :title="item.promptId">{{ item.outputs.length }} 个 · {{ item.promptId.slice(0, 8) }}…</span>
              <a v-if="item.outputs[0]" class="btn mini" :href="mediaUrl(item.outputs[0], true)" :download="item.outputs[0].filename">下载</a>
            </div>
          </div>
        </div>
      </div>
    </main>
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

const activeBatch = ref<any>(null) // 当前/最近一次批量任务信息
const busy = ref(false)
const batchOutputs = ref<Out[]>([]) // 本批全部 done 输出
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
async function loadWorkflows() {
  try {
    const res: any = await $fetch('/api/workflows')
    workflows.value = res.workflows || []
    if (!selectedFile.value && workflows.value.length) await selectWorkflow(workflows.value[0])
  } catch { workflows.value = [] }
}
async function selectWorkflow(wf: any) {
  if (wf.broken) return
  selectedFile.value = wf.file
  busy.value = false
  advOpen.value = false
  if (pollTimer.value) clearInterval(pollTimer.value)
  activeBatch.value = null
  batchOutputs.value = []
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
      const label = title === name ? name : `${title} · ${name}`
      let kind: FieldDef['kind'] = 'text'
      let options: string[] | undefined
      let step: number | undefined
      let isSeed = false
      const ct = String(node?.class_type || '')
      if (ct === 'LoadImage') continue // 图片走队列
      if (typeof value === 'number') { kind = 'number'; isSeed = /seed/i.test(name); if (!isSeed) step = Number.isInteger(value) ? 1 : 0.01 }
      else if (typeof value === 'boolean') kind = 'bool'
      else if (typeof value === 'string') {
        if (name === 'sampler_name') { kind='select'; options=SAMPLERS }
        else if (name === 'scheduler') { kind='select'; options=SCHEDULERS }
        else if (/^(text|prompt|positive_prompt|negative_prompt|caption|positive_text|negative_text)$/i.test(name)) kind='textarea'
        else kind='text'
      }
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
const advancedFields = computed(() => fields.value.filter(f=>f.kind!=='textarea'))
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

// ===== 批量生成 =====
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
  if (!graph.value) return

  const seedOv = seedField.value ? seedField.value : null

  busy.value = true
  batchOutputs.value = []
  progress.status = 'queued'
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
        baseOverrides: buildBaseOverrides(),
        // 前端已知 seed 节点：让后端再找一遍其实更稳
      }
    })
    activeBatch.value = res
    startPolling(res.id)
  } catch(e:any){
    busy.value=false
    progress.status='error'
    progress.message = e?.data?.message || e?.data?.error?.message || e?.message || '批量启动失败'
  }
}

let esBatch: any = null
function startPolling(batchId: string) {
  // 关闭旧 SSE
  if (esBatch) { esBatch.close(); esBatch=null }
  pollTimer.value = setInterval(async ()=>{
    try {
      const info:any = await $fetch(`/api/batch/${batchId}`)
      if (info.exists===false) { stopPolling(); return }
      activeBatch.value = info
      onBatchUpdate(info)
      if (isFinished(info)) stopPolling()
    } catch { /* ignore */ }
  }, 1500)
  pollNow(batchId)
}
async function pollNow(id:string){
  try { const info:any=await $fetch(`/api/batch/${id}`); if(info.exists!==false){ activeBatch.value=info; onBatchUpdate(info); if(isFinished(info)) stopPolling() } }catch{}
}
function onBatchUpdate(info:any) {
  if (info.finishedAt) busy.value=false
  // 收集本批 done outputs（简单：靠前端刷新 history）
}
function stopPolling(){
  if (pollTimer.value){ clearInterval(pollTimer.value); pollTimer.value=null }
  if (esBatch){ esBatch.close(); esBatch=null }
  busy.value=false
  refreshHistory()
}
function isFinished(info:any){
  if (info.cancelled) return true
  return !!info.finishedAt
}
async function stopBatch(){
  if (!activeBatch.value) return
  try { await $fetch(`/api/batch/${activeBatch.value.id}`,{method:'DELETE'}) } catch{}
  stopPolling()
  refreshHistory()
}

// ===== 派生 =====
const progress = reactive<{status:string; message:string}>({status:'', message:''})
const doneItems = computed(()=> activeBatch.value?.items?.filter((i:any)=>i.status==='done') || [])
const totalItems = computed(()=> activeBatch.value?.items?.length || 0)
const batchPercent = computed(()=> totalItems.value? Math.round(doneItems.value.length/totalItems.value*100) : 0)
const batchText = computed(()=> {
  if (!activeBatch.value) return ''
  const r = activeBatch.value.items||[]
  const done=r.filter((i:any)=>i.status==='done').length
  const err=r.filter((i:any)=>i.status==='error').length
  const run=r.filter((i:any)=>i.status==='running').length
  return `已完成 ${done}/${r.length}${run?` · ${run} 进行中`:''}${err?` · ${err} 失败`:''}`
})
const batchDoneOutputs = computed<Out[]>(()=>{
  const list:Out[]=[]
  for (const item of (activeBatch.value?.items||[])) {
    if (item.status==='done') for (const o of item.outputs||[]) {
      list.push({ ...o, src: mediaUrl(o, true) })
    }
  }
  return list
})
const progressMessage = computed(()=>progress.message)

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
// 历史提示词：摘要展示 + 一键复用
function promptText(item: any): string {
  const vals = Object.values<string>(item?.prompts || {})
  return vals.join(' / ')
}
function hasPrompts(item: any): boolean {
  return !!item?.prompts && Object.keys(item.prompts).length > 0
}
function applyPrompt(item: any) {
  let n = 0
  for (const [k, v] of Object.entries<any>(item?.prompts || {})) {
    if (k in form) { form[k] = v; n++ }
  }
  if (n) scheduleFormSave()
}
function mediaUrl(r:any, bust=false) {
  const q = new URLSearchParams({ filename:r.filename, subfolder:r.subfolder||'', type:r.type||'output' })
  if (bust) q.append('cache','0')
  return `/api/view?${q.toString()}`
}
function runningOnWorkflow(file:string){
  return activeBatch.value && activeBatch.value.workflow===file && !activeBatch.value.finishedAt
}

// ===== 启动 =====
// 刷新保留：图片队列变动立即存，提示词防抖存
watch(images, () => { if (selectedFile.value) saveSession() }, { deep: true })
watch(form, () => scheduleFormSave(), { deep: true })

onMounted(()=>{ loadWorkflows(); refreshHistory() })
</script>

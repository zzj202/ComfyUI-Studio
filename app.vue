<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="logo">◆</span>
        <span class="title">ComfyUI Studio</span>
        <span class="subtitle">可视化任务台</span>
      </div>
      <div class="topbar-right">
        <!-- 系统状态面板：GPU / 显存 / 服务端队列（数据来自 ComfyUI /system_stats + /queue） -->
        <div class="sys-wrap" ref="sysWrap">
          <button class="sys-chip" :class="sysClass" title="点击查看 GPU / 显存 / 服务端队列详情" @click="sysOpen = !sysOpen">
            <span class="dot"></span>
            <span class="sys-gpu">{{ gpuShort }}</span>
            <span v-if="sys?.ok" class="sys-queue" :class="{ busy: (sys.queue.running + sys.queue.pending) > 0 }">▶{{ sys.queue.running }} ⏳{{ sys.queue.pending }}</span>
            <span v-else-if="sys?.ok === false" class="sys-off">离线</span>
          </button>
          <transition name="pop">
            <div v-if="sysOpen" class="sys-panel" @click.stop>
              <template v-if="sys?.ok">
                <div class="sys-row head">
                  <span class="sys-device" :title="sys.device.name">{{ sys.device.name }}</span>
                  <span class="sys-ver">{{ sys.version }}</span>
                </div>
                <div class="sys-row">
                  <span class="lbl">显存</span>
                  <div class="vram">
                    <div class="vram-bar"><i :style="{ width: sys.device.vramPct + '%' }" :class="{ hot: sys.device.vramPct > 85 }"></i></div>
                    <span class="vram-num">{{ fmtBytes(sys.device.vramUsed) }} / {{ fmtBytes(sys.device.vramTotal) }}</span>
                  </div>
                </div>
                <div class="sys-row">
                  <span class="lbl">服务端队列</span>
                  <span class="val">▶ 运行中 {{ sys.queue.running }} · ⏳ 排队 {{ sys.queue.pending }}</span>
                </div>
                <div class="sys-row"><span class="lbl">环境</span><span class="val">{{ sys.os || '—' }} · Py {{ sys.python || '—' }} · Torch {{ sys.device.torch || '—' }}</span></div>
                <div class="sys-row"><span class="lbl">服务地址</span><span class="val mono" :title="sys.base">{{ sys.base }}</span></div>
                <div class="sys-actions">
                  <button class="btn small" :disabled="interrupting || sys.queue.running === 0" title="中断 ComfyUI 当前正在执行的任务（/interrupt）" @click="interruptCurrent">{{ interrupting ? '中断中…' : '⏸ 中断当前任务' }}</button>
                  <button class="btn small" @click="refreshSystem">↻ 刷新</button>
                </div>
                <!-- ComfyUI 全量 API 工具区 -->
                <div class="sys-tools">
                  <button class="btn small" title="查看 ComfyUI 服务端队列详情，可清除排队任务（/queue）" @click="openQueuePanel">📋 队列管理<span v-if="queueCount" class="badge-num">{{ queueCount }}</span></button>
                  <button class="btn small" title="读取服务端全部节点定义 / 模型清单 / 嵌入式词嵌入 / 扩展（/object_info /models /embeddings /extensions）" @click="openCapPanel">🧩 服务端能力<span v-if="capInfo" class="badge-num">{{ capInfo.nodeCount }}</span></button>
                  <button class="btn small" title="释放 ComfyUI 已加载的模型与显存（/free），长任务前腾空间" :disabled="freeing" @click="freeModels">{{ freeing ? '释放中…' : '🧹 释放显存' }}</button>
                  <button class="btn small" title="清空 ComfyUI 服务器上的全部历史记录（/history clear），不影响本地文件" @click="clearServerHistory">🗑 清服务端历史</button>
                </div>
              </template>
              <template v-else>
                <div class="sys-offline">
                  <p>⚠ ComfyUI 服务未连接</p>
                  <p class="muted">{{ sys?.base }}<br>{{ sys?.error || '' }}</p>
                  <button class="btn small" @click="refreshSystem">↻ 重新检测</button>
                </div>
              </template>
            </div>
          </transition>
        </div>
        <button class="btn small" :title="soundEnabled ? '批次完成提示音：已开启，点击关闭' : '批次完成提示音：已关闭，点击开启'" @click="toggleSound">{{ soundEnabled ? '🔔 音效开' : '🔕 音效关' }}</button>
        <!-- 低频操作收进「更多」菜单，保持顶栏清爽 -->
        <div class="more-wrap" ref="moreWrap">
          <button class="btn small more-btn-round" title="更多操作：打开 ComfyUI / 清空队列 / 重置输入 / 连接设置" @click="moreOpen = !moreOpen">⋯</button>
          <transition name="pop">
            <div v-if="moreOpen" class="more-menu" @click.stop>
              <a v-if="sys?.base" class="more-item" :href="sys.base" target="_blank" title="在新标签页打开 ComfyUI 原生界面">🖥 打开 ComfyUI 原生界面</a>
              <button v-if="mgmtActions.clearBatches" class="more-item" title="清空 ComfyUI 队列里的排队任务（正在运行的任务会被中止，需二次确认）" @click="mgmtActions.clearBatches(); moreOpen = false">🗑 清空 ComfyUI 队列</button>
              <button v-if="mgmtActions.resetInputs" class="more-item" title="清空参考图与全部提示词输入" @click="mgmtActions.resetInputs(); moreOpen = false">♻️ 重置输入区</button>
              <button class="more-item" @click="moreOpen = false; openSettings()">⚙ 连接设置…</button>
            </div>
          </transition>
        </div>
      </div>
    </header>

    <!-- 连接设置弹窗 -->
    <div v-if="showSettings" class="modal-mask" @click.self="showSettings = false">
      <div class="modal">
        <h3>ComfyUI 连接设置</h3>
        <div class="field">
          <label>服务地址（域名 / 反代地址 / 本机地址均可）</label>
          <input
            type="text"
            v-model="settingsUrl"
            placeholder="例如 https://comfy.example.com 或 http://127.0.0.1:8188"
            @keyup.enter="saveSettings"
          />
        </div>
        <div v-if="settingsMsg" class="settings-msg" :class="{ error: !settingsOk }">{{ settingsMsg }}</div>
        <div class="modal-actions">
          <button class="btn" @click="showSettings = false">关闭</button>
          <button class="btn primary" :disabled="saving" @click="saveSettings">
            {{ saving ? '测试连接中…' : '测试并保存' }}
          </button>
        </div>
        <p class="muted small-note">
          保存后立即生效，无需重启；地址会持久化到 <code>data/settings.json</code>，优先于 .env。
        </p>
      </div>
    </div>

    <!-- ComfyUI 服务端队列管理（/queue） -->
    <div v-if="showQueue" class="modal-mask" @click.self="showQueue = false">
      <div class="modal wide">
        <h3>📋 ComfyUI 服务端队列 <span class="muted" style="font-size:12px;font-weight:450">（数据源：/queue）</span></h3>
        <div v-if="queueLoading" class="muted" style="padding:14px 0">读取中…</div>
        <template v-else>
          <div class="q-sec">
            <div class="q-title">▶ 正在运行（{{ queue.running.length }}）</div>
            <div v-if="!queue.running.length" class="muted small-note">当前没有运行中的任务</div>
            <div v-for="t in queue.running" :key="t.promptId" class="q-item">
              <span class="q-id">{{ t.promptId.slice(0, 8) }}…</span>
              <span class="q-sum" :title="t.summary">{{ t.summary || t.nodeCount + ' 节点' }}</span>
              <button class="btn mini" title="中断当前任务（/interrupt）" @click="interruptCurrent">⏸</button>
            </div>
          </div>
          <div class="q-sec">
            <div class="q-title">⏳ 排队中（{{ queue.pending.length }}）</div>
            <div v-if="!queue.pending.length" class="muted small-note">队列为空</div>
            <div v-for="t in queue.pending" :key="t.promptId" class="q-item">
              <span class="q-id">{{ t.promptId.slice(0, 8) }}…</span>
              <span class="q-sum" :title="t.summary">{{ t.summary || t.nodeCount + ' 节点' }}</span>
              <button class="btn mini danger" title="从队列移除该任务（/queue delete）" @click="removeQueued(t.promptId)">✕</button>
            </div>
          </div>
        </template>
        <div class="modal-actions">
          <button class="btn danger" :disabled="!queue.pending.length" @click="clearQueue(false)">清空排队</button>
          <button class="btn danger" :disabled="!queue.pending.length && !queue.running.length" @click="clearQueue(true)">清空全部（含运行中）</button>
          <button class="btn" @click="refreshQueue">↻ 刷新</button>
          <button class="btn primary" @click="showQueue = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- ComfyUI 服务端能力（/object_info /models /embeddings /extensions） -->
    <div v-if="showCap" class="modal-mask" @click.self="showCap = false">
      <div class="modal wide">
        <h3>🧩 ComfyUI 服务端能力 <span class="muted" style="font-size:12px;font-weight:450">（API 直读）</span></h3>
        <div v-if="capLoading" class="muted" style="padding:14px 0">读取中（节点定义较大，请稍候）…</div>
        <template v-else-if="capInfo">
          <div class="cap-tabs">
            <button v-for="t in capTabs" :key="t.key" class="cap-tab" :class="{ on: capTab === t.key }" @click="capTab = t.key">
              {{ t.label }}<span class="badge-num">{{ capCount(t.key) }}</span>
            </button>
          </div>
          <div class="cap-body">
            <div v-if="capTab === 'nodes'" class="cap-list">
              <div v-for="n in capInfo.nodes.slice(0, 400)" :key="n" class="cap-item mono">{{ n }}</div>
              <div v-if="capInfo.nodes.length > 400" class="muted small-note">仅显示前 400 项（共 {{ capInfo.nodes.length }}）</div>
            </div>
            <div v-else-if="capTab === 'models'" class="cap-list">
              <div v-for="f in capInfo.models.folders" :key="f" class="cap-folder">
                <div class="cap-folder-head">{{ f }} <span class="muted">({{ (capInfo.models.files[f] || []).length }})</span></div>
                <div v-for="m in (capInfo.models.files[f] || []).slice(0, 12)" :key="m" class="cap-item mono">{{ m }}</div>
                <div v-if="(capInfo.models.files[f] || []).length > 12" class="muted small-note">…等 {{ (capInfo.models.files[f] || []).length }} 个</div>
              </div>
            </div>
            <div v-else-if="capTab === 'embeddings'" class="cap-list">
              <div v-for="e in capInfo.embeddings" :key="e" class="cap-item mono">{{ e }}</div>
              <div v-if="!capInfo.embeddings.length" class="muted small-note">无嵌入式词嵌入</div>
            </div>
            <div v-else class="cap-list">
              <div v-for="x in capInfo.extensions" :key="x" class="cap-item mono">{{ x }}</div>
              <div v-if="!capInfo.extensions.length" class="muted small-note">无扩展</div>
            </div>
          </div>
        </template>
        <div v-else class="muted" style="padding:14px 0">读取失败，服务端可能不可用</div>
        <div class="modal-actions">
          <button class="btn" @click="loadCapabilities">↻ 重新读取</button>
          <button class="btn primary" @click="showCap = false">关闭</button>
        </div>
      </div>
    </div>

    <NuxtPage />
  </div>
</template>

<script setup lang="ts">
import { provide, reactive } from 'vue'

// ---------- 系统状态面板（ComfyUI /system_stats + /queue） ----------
const sys = ref<any>(null)
const sysOpen = ref(false)
const sysWrap = ref<HTMLElement | null>(null)
const interrupting = ref(false)
// 「更多」菜单
const moreOpen = ref(false)
const moreWrap = ref<HTMLElement | null>(null)

const sysClass = computed(() => (sys.value?.ok === true ? 'ok' : sys.value?.ok === false ? 'bad' : 'unknown'))
// GPU 名称压缩：cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync → RTX 5090
const gpuShort = computed(() => {
  if (sys.value?.ok) {
    const m = String(sys.value.device?.name || '').match(/(GeForce\s+)?(RTX\s*[\d\sFXiT]+|GTX\s*[\d\sFXiT]+|A\d+|H\d+|Radeon[^(]*)/i)
    const t = (m?.[2] || sys.value.device?.name || '').replace(/\s+/g, ' ').trim()
    return t.split(' : ')[0].slice(0, 22)
  }
  if (sys.value?.ok === false) return 'ComfyUI'
  return '检测中…'
})

async function refreshSystem() {
  try {
    sys.value = await $fetch('/api/system', { timeout: 20000 })
  } catch (e: any) {
    sys.value = { ok: false, error: e?.message }
  }
}

async function interruptCurrent() {
  interrupting.value = true
  try {
    await $fetch('/api/system/interrupt', { method: 'POST', timeout: 12000 })
    await refreshSystem()
  } catch { /* 面板内失败静默，刷新即知 */ }
  finally { interrupting.value = false }
}

function fmtBytes(n: number) {
  if (!n || n <= 0) return '0 GB'
  const gb = n / 1024 ** 3
  return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`
}

// ---------- ComfyUI 服务端队列管理（/queue 读写） ----------
const showQueue = ref(false)
const queueLoading = ref(false)
const queue = ref<{ running: any[]; pending: any[] }>({ running: [], pending: [] })
const queueCount = computed(() => queue.value.running.length + queue.value.pending.length)

async function refreshQueue() {
  queueLoading.value = true
  try {
    const res: any = await $fetch('/api/comfy/queue', { timeout: 15000 })
    if (res?.ok) queue.value = { running: res.running || [], pending: res.pending || [] }
  } catch { /* 面板内保持旧数据 */ }
  finally { queueLoading.value = false }
}
function openQueuePanel() {
  showQueue.value = true
  refreshQueue()
}
async function removeQueued(promptId: string) {
  try {
    await $fetch('/api/comfy/queue', { method: 'DELETE', body: { promptId }, timeout: 12000 })
    await refreshQueue()
    await refreshSystem()
  } catch (e: any) { sys.value = { ...sys.value, error: e?.data?.message || e?.message } }
}
async function clearQueue(includeRunning: boolean) {
  const msg = includeRunning
    ? '清空全部队列？正在运行的任务也会被中止。'
    : '清空排队中的任务？（不影响正在运行的）'
  if (!confirm(msg)) return
  try {
    await $fetch('/api/comfy/queue', { method: 'POST', body: { pending: true, running: includeRunning }, timeout: 12000 })
    await refreshQueue()
    await refreshSystem()
  } catch { /* 失败静默，刷新可见 */ }
}

// ---------- ComfyUI 服务端能力（/object_info /models /embeddings /extensions） ----------
const showCap = ref(false)
const capLoading = ref(false)
const capInfo = ref<any>(null)
const capTab = ref<'nodes' | 'models' | 'embeddings' | 'extensions'>('nodes')
const capTabs = [
  { key: 'nodes' as const, label: '节点' },
  { key: 'models' as const, label: '模型' },
  { key: 'embeddings' as const, label: '词嵌入' },
  { key: 'extensions' as const, label: '扩展' }
]
function capCount(k: string) {
  const c = capInfo.value
  if (!c) return 0
  if (k === 'nodes') return (c.nodes || []).length
  if (k === 'models') return (c.models?.folders || []).length
  if (k === 'embeddings') return (c.embeddings || []).length
  return (c.extensions || []).length
}
async function loadCapabilities() {
  capLoading.value = true
  try {
    const [nodes, rest]: any[] = await Promise.all([
      $fetch('/api/comfy/node', { timeout: 30000 }),      // 仅节点名列表（轻量）
      $fetch('/api/comfy/info?what=models', { timeout: 40000 }).catch(() => ({ folders: [], files: {} }))
    ])
    const emb: any = await $fetch('/api/comfy/info?what=embeddings', { timeout: 15000 }).catch(() => ({ embeddings: [] }))
    const ext: any = await $fetch('/api/comfy/info?what=extensions', { timeout: 15000 }).catch(() => ({ extensions: [] }))
    capInfo.value = {
      nodes: nodes?.nodes || [],
      models: { folders: rest?.folders || [], files: rest?.files || {} },
      embeddings: emb?.embeddings || [],
      extensions: ext?.extensions || []
    }
  } catch { capInfo.value = null }
  finally { capLoading.value = false }
}
function openCapPanel() {
  showCap.value = true
  if (!capInfo.value) loadCapabilities()
}

// ---------- 释放显存 / 清空服务端历史 ----------
const freeing = ref(false)
async function freeModels() {
  freeing.value = true
  try {
    await $fetch('/api/comfy/history', { method: 'POST', body: { free: true, unload_models: true, free_memory: true }, timeout: 20000 })
    await refreshSystem()
  } catch { /* 静默 */ }
  finally { freeing.value = false }
}
async function clearServerHistory() {
  if (!confirm('清空 ComfyUI 服务器上的全部历史记录？\n（只影响服务端历史列表，已下载到本地的文件不受影响）')) return
  try {
    await $fetch('/api/comfy/history', { method: 'POST', body: {}, timeout: 15000 })
    await refreshSystem()
  } catch { /* 静默 */ }
}

function onDocClick(e: MouseEvent) {
  const t = e.target as Node
  if (sysOpen.value && sysWrap.value && !sysWrap.value.contains(t)) sysOpen.value = false
  if (moreOpen.value && moreWrap.value && !moreWrap.value.contains(t)) moreOpen.value = false
}

onMounted(() => {
  refreshSystem()
  setInterval(refreshSystem, 10000)
  setInterval(() => { if (sysOpen.value) refreshQueue() }, 5000) // 面板展开时同步队列
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

// ---------- 连接设置 ----------
const showSettings = ref(false)
const settingsUrl = ref('')
const settingsMsg = ref('')
const settingsOk = ref(false)
const saving = ref(false)

async function openSettings() {
  settingsMsg.value = ''
  showSettings.value = true
  try {
    const cfg: any = await $fetch('/api/config')
    settingsUrl.value = cfg.comfyBaseUrl || ''
  } catch { /* 保持当前输入 */ }
}

async function saveSettings() {
  if (!settingsUrl.value.trim()) {
    settingsOk.value = false
    settingsMsg.value = '请先填写地址'
    return
  }
  saving.value = true
  settingsMsg.value = ''
  try {
    const res: any = await $fetch('/api/config', {
      method: 'POST',
      body: { comfyBaseUrl: settingsUrl.value }
    })
    settingsOk.value = !!res.ok
    settingsMsg.value = res.message || ''
    if (res.saved) {
      await refreshSystem() // 保存成功后立即刷新顶部系统状态
    }
  } catch (e: any) {
    settingsOk.value = false
    settingsMsg.value = e?.data?.message || e?.statusMessage || e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

// ---------- 管理菜单栏：音效 + 页面级动作注册表 ----------
// 音效引擎在全局壳层（页面切换不丢状态）；页面动作（清空历史/队列/输入区）由 index.vue 注册进来
const SOUND_KEY = 'soundEnabled:v1'
const soundEnabled = ref((() => { try { return JSON.parse(localStorage.getItem(SOUND_KEY) || 'null') ?? true } catch { return true } })())
let audioCtx: AudioContext | null = null
function ensureAudio() {
  // AudioContext 需要用户手势才能启动：在提交/开关点击时预热
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    audioCtx ||= new Ctx()
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  } catch { audioCtx = null }
}
// 后备提示音：WebAudio 不可用/被暂停时，直接播 public/beep.wav（不依赖 AudioContext）
function fallbackBeep(loud: boolean) {
  // loud（全部任务完成）→ 3 遍、间隔 3.5s，总时长约 10 秒
  const rounds = loud ? 3 : 1
  for (let i = 0; i < rounds; i++) {
    setTimeout(() => {
      try {
        const a = new Audio('/beep.wav')
        a.volume = 1
        a.play().catch(() => console.warn('[chime] 后备提示音播放失败（可能被浏览器拦截）'))
      } catch { console.warn('[chime] 后备提示音异常') }
    }, i * 3500)
  }
}
function chime(loud: boolean) {
  if (!audioCtx || audioCtx.state !== 'running') { fallbackBeep(loud); return }
  const t0 = audioCtx.currentTime
  const rounds = loud ? 3 : 1 // 全部任务完成 → 重复 3 遍，人在别处也能听见
  const roundGap = loud ? 3.5 : 1.5 // loud：轮间隔 3.5s + 尾音 2.3s → 总时长约 10 秒
  const noteGap = loud ? 0.35 : 0.18
  const tail = loud ? 2.2 : 1.1
  for (let r = 0; r < rounds; r++) {
    const t = t0 + r * roundGap
    // A5 → C#6 → E6 上行三连音「叮-叮-咚」（音量大、尾音长）
    ;[880, 1108.7, 1318.5].forEach((f, i) => {
      const o = audioCtx!.createOscillator()
      const g = audioCtx!.createGain()
      o.type = 'sine'
      o.frequency.value = f
      const st = t + i * noteGap
      g.gain.setValueAtTime(0.0001, st)
      g.gain.linearRampToValueAtTime(0.45, st + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, st + tail)
      o.connect(g).connect(audioCtx!.destination)
      o.start(st)
      o.stop(st + tail + 0.1)
    })
  }
}
function playChime(loud = false) {
  try {
    ensureAudio()
    if (!audioCtx) { console.warn('[chime] WebAudio 不可用 → 后备提示音'); fallbackBeep(loud); return }
    if (audioCtx.state !== 'running') {
      // AudioContext 恢复是异步的：等 resume 成功后再补播；恢复失败/挂起都退回后备提示音
      const ctx = audioCtx
      let handled = false
      const settle = () => {
        if (handled) return
        handled = true
        if (ctx.state === 'running') chime(loud)
        else { console.warn('[chime] AudioContext 恢复失败(state=' + ctx.state + ') → 后备提示音'); fallbackBeep(loud) }
      }
      ctx.resume?.().then(settle).catch(() => { console.warn('[chime] AudioContext resume 异常 → 后备提示音'); fallbackBeep(loud) })
      // 兜底：resume 被浏览器静默挂起时 promise 永不 resolve → 800ms 后强制走后备，避免彻底无声
      setTimeout(settle, 800)
      return
    }
    chime(loud)
  } catch (e) { console.warn('[chime] 播放异常 → 后备提示音', e); fallbackBeep(loud) }
}
function toggleSound() {
  soundEnabled.value = !soundEnabled.value
  try { localStorage.setItem(SOUND_KEY, JSON.stringify(soundEnabled.value)) } catch {}
  if (soundEnabled.value) playChime() // 开启时给一声试听确认
}
const mgmtActions = reactive<Record<string, (() => void)>>({})
provide('mgmt', { soundEnabled, playChime, ensureAudio, mgmtActions })

useHead({ title: 'ComfyUI Studio' })
</script>

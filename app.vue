<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="logo">◆</span>
        <span class="title">ComfyUI Studio</span>
        <span class="subtitle">可视化任务台</span>
      </div>
      <div class="topbar-right">
        <div class="health" :class="healthClass" @click="refreshHealth" :title="healthTip">
          <span class="dot"></span>
          <span>{{ healthText }}</span>
        </div>
        <button class="btn small" :title="soundEnabled ? '批次完成提示音：已开启，点击关闭' : '批次完成提示音：已关闭，点击开启'" @click="toggleSound">{{ soundEnabled ? '🔔 音效开' : '🔕 音效关' }}</button>
        <button v-if="mgmtActions.clearHistory" class="btn small" title="隐藏当前显示的全部历史资产（不影响服务器上的文件）" @click="mgmtActions.clearHistory()">🧹 清空最近产出</button>
        <button v-if="mgmtActions.clearBatches" class="btn small" title="收起下方本会话批次列表（不影响服务器上正在进行的生成）" @click="mgmtActions.clearBatches()">🗑 清空批次列表</button>
        <button v-if="mgmtActions.resetInputs" class="btn small" title="清空参考图与全部提示词输入" @click="mgmtActions.resetInputs()">♻️ 重置输入区</button>
        <a v-if="health.base" class="btn small" :href="health.base" target="_blank" title="在新标签页打开 ComfyUI 原生界面">🖥 ComfyUI</a>
        <button class="btn small" @click="openSettings">⚙ 连接设置</button>
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

    <NuxtPage />
  </div>
</template>

<script setup lang="ts">
import { provide, reactive } from 'vue'

const health = ref<any>({ ok: null })
const healthClass = computed(() => (health.value?.ok === true ? 'ok' : health.value?.ok === false ? 'bad' : 'unknown'))
const healthText = computed(() =>
  health.value?.ok === true ? `已连接 ${health.value.version || ''}` : health.value?.ok === false ? 'ComfyUI 未连接' : '检测中…'
)
const healthTip = computed(() =>
  health.value?.ok === false ? `无法访问 ${health.value.base}（点击重试）：${health.value.error || ''}` : `服务地址：${health.value.base || ''}（点击重新检测）`
)

async function refreshHealth() {
  try {
    health.value = await $fetch('/api/health')
  } catch (e: any) {
    health.value = { ok: false, error: e?.message }
  }
}

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
      await refreshHealth() // 保存成功后立即刷新顶部连接状态
    }
  } catch (e: any) {
    settingsOk.value = false
    settingsMsg.value = e?.data?.message || e?.statusMessage || e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  refreshHealth()
  setInterval(refreshHealth, 30000)
})

// ---------- 管理菜单栏：音效 + 页面级动作注册表 ----------
// 音效引擎在全局壳层（页面切换不丢状态）；页面动作（清空历史/批次/输入区）由 index.vue 注册进来
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
function playChime() {
  try {
    ensureAudio()
    if (!audioCtx || audioCtx.state !== 'running') return
    const t = audioCtx.currentTime
    // A5 → E6 双音上行「叮咚」
    ;[880, 1318.5].forEach((f, i) => {
      const o = audioCtx!.createOscillator()
      const g = audioCtx!.createGain()
      o.type = 'sine'
      o.frequency.value = f
      const st = t + i * 0.13
      g.gain.setValueAtTime(0.0001, st)
      g.gain.linearRampToValueAtTime(0.16, st + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.55)
      o.connect(g).connect(audioCtx!.destination)
      o.start(st)
      o.stop(st + 0.6)
    })
  } catch { /* 音效失败不影响主流程 */ }
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

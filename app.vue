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

useHead({ title: 'ComfyUI Studio' })
</script>

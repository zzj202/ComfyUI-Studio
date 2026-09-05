// 健康检查：探测 ComfyUI 可达性
export default defineEventHandler(async () => {
  const base = comfyBase()
  try {
    const stats: any = await $fetch(`${base}/system_stats`, { timeout: 5000 })
    return {
      ok: true,
      base,
      version: stats?.system?.comfyui_version || '未知',
      device: stats?.devices?.[0]
        ? { name: stats.devices[0].name, vram_total: stats.devices[0].vram_total }
        : null
    }
  } catch (e: any) {
    return { ok: false, base, error: e?.message || String(e) }
  }
})

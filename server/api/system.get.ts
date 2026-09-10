// 系统状态：聚合 ComfyUI /system_stats + /queue，供顶栏状态面板展示
export default defineEventHandler(async () => {
  const base = comfyBase()
  try {
    // 串行获取且队列允许失败：远端 pod 偶发慢响应时，状态仍可用
    const stats = await $fetch<any>(`${base}/system_stats`, { timeout: 12000 })
    let q = { running: 0, pending: 0 }
    try {
      const queue = await $fetch<any>(`${base}/queue`, { timeout: 8000 })
      q = { running: queue?.queue_running?.length || 0, pending: queue?.queue_pending?.length || 0 }
    } catch { /* 队列未知不影响状态展示 */ }
    const dev = stats?.devices?.[0] || {}
    const vramTotal = Number(dev.vram_total || 0)
    const vramFree = Number(dev.vram_free || 0)
    return {
      ok: true,
      base,
      version: stats?.system?.comfyui_version || '未知',
      os: stats?.system?.os || '',
      python: (stats?.system?.python_version || '').split(' ').slice(0, 2).join(' '),
      device: {
        name: dev.name || '未知设备',
        type: dev.type || '',
        torch: dev.torch_version || '',
        vramTotal,
        vramFree,
        vramUsed: vramTotal > 0 ? Math.max(0, vramTotal - vramFree) : 0,
        vramPct: vramTotal > 0 ? Math.min(100, Math.round(((vramTotal - vramFree) / vramTotal) * 100)) : 0
      },
      queue: q
    }
  } catch (e: any) {
    return { ok: false, base, error: e?.message || String(e) }
  }
})

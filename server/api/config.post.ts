// 保存并立即测试 ComfyUI 地址
export default defineEventHandler(async (event) => {
  const body = await readBody<any>(event)
  const url = String(body?.comfyBaseUrl || '').trim().replace(/\/+$/, '')

  if (!url) {
    throw createError({ statusCode: 400, message: '地址不能为空' })
  }
  if (!/^https?:\/\/.+/.test(url)) {
    throw createError({ statusCode: 400, message: '地址需以 http:// 或 https:// 开头' })
  }

  // 先探测再保存：连不上就不落盘，避免把可用配置覆盖坏
  let test: any = null
  try {
    test = await $fetch(`${url}/system_stats`, { timeout: 6000 })
  } catch (e: any) {
    return {
      saved: false,
      ok: false,
      message: `地址可达性测试失败：${e?.message || e}（未保存，请检查地址/网络）`
    }
  }

  writeSettings({ comfyBaseUrl: url })
  return {
    saved: true,
    ok: true,
    comfyBaseUrl: url,
    version: test?.system?.comfyui_version || '未知',
    device: test?.devices?.[0]?.name || null,
    message: `已保存并连接成功（ComfyUI ${test?.system?.comfyui_version || ''}）`
  }
})

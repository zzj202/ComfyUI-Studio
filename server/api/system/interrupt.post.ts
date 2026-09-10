// 中断 ComfyUI 当前正在执行的任务（POST /interrupt）
export default defineEventHandler(async () => {
  const base = comfyBase()
  try {
    await $fetch(`${base}/interrupt`, { method: 'POST', timeout: 8000 })
    return { ok: true, message: '已发送中断指令' }
  } catch (e: any) {
    throw createError({ statusCode: 502, message: `中断失败: ${e?.message || e}` })
  }
})

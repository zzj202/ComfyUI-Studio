// 单个任务结果：/api/history/:promptId
export default defineEventHandler(async (event) => {
  const base = comfyBase()
  const id = getRouterParam(event, 'id')
  try {
    const h: any = await $fetch(`${base}/history/${id}`, { timeout: 8000 })
    const entry = h?.[id]
    if (!entry) return { found: false, outputs: [] }
    return {
      found: true,
      status: entry?.status?.status_str || 'success',
      completed: !!entry?.status?.completed,
      outputs: normalizeOutputs(entry)
    }
  } catch (e: any) {
    throw createError({ statusCode: 502, message: `无法读取 ComfyUI history: ${e?.message || e}` })
  }
})

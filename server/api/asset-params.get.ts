// 读取某个资产提交时的完整工作流图（ComfyUI history 里存有提交的 API 图），用于一键复用全部参数
export default defineEventHandler(async (event) => {
  const base = comfyBase()
  const promptId = String(getQuery(event).promptId || '')
  if (!promptId) throw createError({ statusCode: 400, message: '缺少 promptId' })
  try {
    const h: any = await $fetch(`${base}/history/${promptId}`, { timeout: 10000 })
    const entry = h?.[promptId]
    // entry.prompt = [number, workflowId, 提交时的 API 格式图]
    const graph = entry?.prompt?.[2]
    if (!graph || typeof graph !== 'object') {
      throw createError({ statusCode: 404, message: '该资产没有可读取的提交参数' })
    }
    return { graph }
  } catch (e: any) {
    if (e?.statusCode) throw e
    throw createError({ statusCode: 502, message: `无法读取 ComfyUI history: ${e?.message || e}` })
  }
})

// 提交任务到 ComfyUI 队列
export default defineEventHandler(async (event) => {
  const base = comfyBase()
  const body = await readBody<any>(event)
  const clientId = String(body?.clientId || '')
  const overrides = body?.overrides || {}

  let graph: any
  if (body?.graph) {
    // 前端直接传整张图（保留扩展可能）
    graph = body.graph
  } else {
    const res = readWorkflowFile(String(body?.workflow || ''))
    if (!res.ok) throw createError({ statusCode: 400, message: res.error })
    graph = res.graph
  }

  // 应用参数覆盖：{ nodeId: { fieldName: value } }
  for (const [nodeId, fields] of Object.entries<any>(overrides)) {
    if (!graph[nodeId]) continue
    graph[nodeId].inputs = { ...graph[nodeId].inputs, ...fields }
  }

  try {
    const res: any = await $fetch(`${base}/prompt`, {
      method: 'POST',
      body: { prompt: graph, client_id: clientId }
    })
    return { prompt_id: res.prompt_id, number: res.number }
  } catch (e: any) {
    // ComfyUI 校验失败时返回 { error, node_errors }
    const data = e?.data || e?.response?._data
    if (data) {
      throw createError({
        statusCode: 400,
        message: data?.error?.message || '提交被 ComfyUI 拒绝',
        data
      })
    }
    throw createError({ statusCode: 502, message: `无法连接 ComfyUI: ${e?.message || e}` })
  }
})

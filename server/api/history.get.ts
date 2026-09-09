// 最近产出列表：代理 ComfyUI /history
export default defineEventHandler(async (event) => {
  const base = comfyBase()
  const max = Number(getQuery(event).max || 20)
  try {
    const h: any = await $fetch(`${base}/history`, {
      params: { max_items: max },
      timeout: 10000
    })
    const items = Object.entries<any>(h || {})
      .map(([promptId, entry]) => {
        const ep = extractPrompts(entry)
        return {
          promptId,
          completed: !!entry?.status?.completed,
          status: entry?.status?.status_str || 'success',
          outputs: normalizeOutputs(entry),
          // 从提交时的 API 图里提取提示词文本：{ "节点ID.字段名": 文本 }
          prompts: ep.prompts,
          // 节点标题映射：{ "节点ID.字段名": 节点_meta.title }，用于前端识别「中」提示词
          promptTitles: ep.promptTitles,
          // 生成耗时（毫秒）：execution_start → execution_success/error 时间戳差
          durationMs: extractDurationMs(entry)
        }
      })
      .filter((it) => it.outputs.length > 0)
      .reverse() // ComfyUI 返回按完成先后排序（旧→新），反转成最新在前
      .slice(0, max)
    return { items }
  } catch (e: any) {
    throw createError({ statusCode: 502, message: `无法读取 ComfyUI history: ${e?.message || e}` })
  }
})

/** 提取生成耗时：execution_start 与 execution_success/error 两条消息的时间戳差（毫秒） */
function extractDurationMs(entry: any): number | null {
  let start: number | null = null
  let end: number | null = null
  for (const m of (entry?.status?.messages || [])) {
    const [type, data] = m
    if (!data || typeof data.timestamp !== 'number') continue
    if (type === 'execution_start') start = data.timestamp
    else if (type === 'execution_success' || type === 'execution_error') end = data.timestamp
  }
  if (start != null && end != null && end >= start) return end - start
  return null
}

/** 提取提交图中的文本类输入（提示词）与 seed，uid 与前端表单一致："nodeId.inputName"；同时返回节点标题 */
function extractPrompts(entry: any): { prompts: Record<string, any>; promptTitles: Record<string, string> } {
  const graph = entry?.prompt?.[2] || {}
  const prompts: Record<string, any> = {}
  const promptTitles: Record<string, string> = {}
  for (const [nodeId, node] of Object.entries<any>(graph)) {
    const inputs = node?.inputs || {}
    const title = String(node?._meta?.title || '')
    for (const [name, value] of Object.entries<any>(inputs)) {
      // 文本输入：常见为 CLIPTextEncode 的 text、PrimitiveStringMultiline 的 value，以及名字带 prompt/caption 的字符串
      if (typeof value === 'string' && value.trim() && (name === 'text' || name === 'value' || /prompt|caption|query/i.test(name))) {
        const uid = `${nodeId}.${name}`
        prompts[uid] = value
        if (title) promptTitles[uid] = title
      }
      // seed（含 noise_seed 等），用于一键复现
      else if (typeof value === 'number' && /seed/i.test(name)) {
        prompts[`${nodeId}.${name}`] = value
      }
    }
  }
  return { prompts, promptTitles }
}

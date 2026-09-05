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
      .map(([promptId, entry]) => ({
        promptId,
        completed: !!entry?.status?.completed,
        status: entry?.status?.status_str || 'success',
        outputs: normalizeOutputs(entry),
        // 从提交时的 API 图里提取提示词文本：{ "节点ID.字段名": 文本 }
        prompts: extractPrompts(entry)
      }))
      .filter((it) => it.outputs.length > 0)
      .reverse() // ComfyUI 返回按完成先后排序（旧→新），反转成最新在前
      .slice(0, max)
    return { items }
  } catch (e: any) {
    throw createError({ statusCode: 502, message: `无法读取 ComfyUI history: ${e?.message || e}` })
  }
})

/** 提取提交图中的文本类输入（提示词），uid 与前端表单一致："nodeId.inputName" */
function extractPrompts(entry: any): Record<string, string> {
  const graph = entry?.prompt?.[2] || {}
  const out: Record<string, string> = {}
  for (const [nodeId, node] of Object.entries<any>(graph)) {
    const inputs = node?.inputs || {}
    for (const [name, value] of Object.entries<any>(inputs)) {
      // 文本输入：常见为 CLIPTextEncode 的 text，以及名字带 prompt/caption 的字符串
      if (typeof value === 'string' && value.trim() && (name === 'text' || /prompt|caption|query/i.test(name))) {
        out[`${nodeId}.${name}`] = value
      }
    }
  }
  return out
}

// 历史记录完整读写：对齐 ComfyUI 原生 /history + /free
//   GET    /api/comfy/history?max=20   → 最近产出（原生 /history 读取 + 产出/提示词/耗时归一化）
//   DELETE /api/comfy/history?promptId=xxx → 删除单条历史
//   POST   /api/comfy/history          → 清空全部历史（body: { all: true }）或释放显存（body: { free: true }）
import { comfyBase, normalizeOutputs } from '../../utils/comfy'

export default defineEventHandler(async (event) => {
  const base = comfyBase()
  const method = getMethod(event)

  // ---- GET：最近产出列表（原 server/api/history.get.ts，前端「最近产出」数据源）----
  if (method === 'GET') {
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
  }

  if (method === 'DELETE') {
    const q = getQuery(event)
    const promptId = String(q.promptId || '')
    if (!promptId) throw createError({ statusCode: 400, message: '缺少 promptId' })
    try {
      await $fetch(`${base}/history`, { method: 'POST', body: { delete: [promptId] }, timeout: 10000 })
      return { ok: true, message: '已从 ComfyUI 服务器删除该历史记录' }
    } catch (e: any) {
      throw createError({ statusCode: 502, message: `删除历史失败: ${e?.message || e}` })
    }
  }

  if (method === 'POST') {
    const body: any = await readBody(event).catch(() => ({}))
    if (body?.free) {
      try {
        await $fetch(`${base}/free`, {
          method: 'POST',
          body: { unload_models: body.unload_models !== false, free_memory: body.free_memory !== false },
          timeout: 15000
        })
        return { ok: true, message: '已请求 ComfyUI 释放模型与显存' }
      } catch (e: any) {
        throw createError({ statusCode: 502, message: `释放失败: ${e?.message || e}` })
      }
    }
    try {
      await $fetch(`${base}/history`, { method: 'POST', body: { clear: true }, timeout: 10000 })
      return { ok: true, message: '已清空 ComfyUI 服务器上的全部历史记录' }
    } catch (e: any) {
      throw createError({ statusCode: 502, message: `清空历史失败: ${e?.message || e}` })
    }
  }

  throw createError({ statusCode: 405, message: '不支持的方法' })
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

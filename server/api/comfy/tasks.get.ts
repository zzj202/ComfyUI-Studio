// ComfyUI 原生任务视图（取代本地「本会话批次」）
//
// 数据源完全来自 ComfyUI 自身的 API，不再维护本地批次列表：
//   /queue     → queue_running + queue_pending（正在跑 / 排队中）
//   /history   → 已完成的 prompt（含 outputs，供「本次批量结果」使用）
//
// 平台只额外补一层「展示元数据」：提交时按 promptId 落盘的
// { workflow, 参考图, seed, 参数覆盖 } 快照（data/jobs/{promptId}.json），
// 用于在队列行上显示工作流名/参考图，以及「复用全部参数」。
// ComfyUI 原生 API 不提供这些业务信息，属于平台自有的旁挂数据。
import { comfyBase, normalizeOutputs } from '../../utils/comfy'
import { readJobMeta, listJobMetas } from '../../utils/jobsnap'

/** 从原生队列条目（[number, promptId, graph, extra]）提取展示信息 */
function mapQueueEntry(it: any, snap: any) {
  const graph = it?.[2] || {}
  const nodeCount = Object.keys(graph).length
  // 参考图：从图里的 LoadImage 节点取（原生 API 不单独返回）
  const images = Object.values<any>(graph)
    .filter((n: any) => n?.class_type === 'LoadImage' && typeof n?.inputs?.image === 'string')
    .map((n: any) => String(n.inputs.image))
  // 工作流名优先取快照（原生 API 不返回文件名），回落节点标题摘要
  const titles = Object.values<any>(graph)
    .map((n: any) => n?._meta?.title || n?.class_type)
    .filter(Boolean)
  return {
    promptId: it?.[1],
    number: it?.[0],
    clientId: it?.[3]?.client_id || '',
    nodeCount,
    images,
    workflow: snap?.workflow || '',
    summary: titles.slice(0, 4).join(' · '),
    seed: snap?.seed ?? null,
    submittedAt: it?.[3]?.create_time ? it[3].create_time * 1000 : (snap?.submittedAt || null)
  }
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 40))
  const base = comfyBase()

  // 快照索引：promptId → 平台侧元数据（工作流/参考图/seed）
  const metas = listJobMetas()

  let queue: any = null
  let queueError = ''
  try {
    queue = await $fetch(`${base}/queue`, { timeout: 10000 })
  } catch (e: any) {
    queueError = e?.message || String(e)
  }

  let hist: any = {}
  try {
    hist = await $fetch(`${base}/history`, { timeout: 12000 })
  } catch { /* 历史拉取失败不致命：队列部分仍可用 */ }

  const running = (queue?.queue_running || []).map((it: any) => mapQueueEntry(it, metas[it?.[1]]))
  const pending = (queue?.queue_pending || []).map((it: any) => mapQueueEntry(it, metas[it?.[1]]))

  // 已完成：/history 直接给出 outputs，倒序取最近 limit 条
  const inQueueIds = new Set([...running, ...pending].map((t: any) => t.promptId))
  const completed = Object.entries<any>(hist || {})
    .map(([promptId, rec]) => {
      const snap = metas[promptId]
      const outputs = normalizeOutputs(rec)
      const clientId = rec?.prompt?.[3]?.client_id || ''
      const createTime = rec?.prompt?.[3]?.create_time ? rec.prompt[3].create_time * 1000 : null
      return {
        promptId,
        clientId,
        outputs,
        outputCount: outputs.length,
        workflow: snap?.workflow || '',
        images: snap?.images || [],
        seed: snap?.seed ?? null,
        submittedAt: createTime || snap?.submittedAt || null,
        status: rec?.status?.status_str || (rec?.status?.completed ? 'success' : ''),
        success: rec?.status?.status_str === 'success' || !!rec?.status?.completed
      }
    })
    .filter((t: any) => !inQueueIds.has(t.promptId) && t.outputCount > 0)
    .sort((a: any, b: any) => (b.submittedAt || 0) - (a.submittedAt || 0))
    .slice(0, limit)

  return {
    ok: !queueError,
    base,
    error: queueError,
    running,
    pending,
    completed,
    queue: { running: running.length, pending: pending.length },
    counts: { running: running.length, pending: pending.length, completed: completed.length }
  }
})

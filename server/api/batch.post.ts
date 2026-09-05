// 创建批量任务（每张图 × 批次，逐单自动连发）
import { createBatch, runBatchLoop, getBatchInfo } from '../utils/batch'
import { comfyBase, readWorkflowFile } from '../utils/comfy'

export default defineEventHandler(async (event) => {
  const body = await readBody<any>(event)

  const workflow = String(body?.workflow || '')
  const images: string[] = (body?.images || []).filter((x: unknown) => typeof x === 'string')
  const batch = Math.max(1, Math.floor(Number(body?.batch) || 1))
  const randSeed = body?.randSeed !== false
  const fixedSeed = body?.fixedSeed != null ? Number(body?.fixedSeed) : null
  const clientId = String(body?.clientId || '')
  const baseOverrides: Record<string, Record<string, any>> = body?.baseOverrides || {}

  if (!workflow) throw createError({ statusCode: 400, message: '缺少工作流' })
  if (!images.length) throw createError({ statusCode: 400, message: '至少需要一张参考图' })
  if (batch > 50) throw createError({ statusCode: 400, message: '批次最多 50' })

  // 定位 image / seed 节点
  const graphRes = readWorkflowFile(workflow)
  if (!graphRes.ok) throw createError({ statusCode: 400, message: graphRes.error })
  const graph = graphRes.graph as any

  let imageNodeId: string | null = null
  let seedNodeId: string | null = null
  let seedKey: string | null = null

  for (const [nid, node] of Object.entries<any>(graph || {})) {
    const ct = String(node?.class_type || '')
    const inputs = node?.inputs || {}
    if (ct === 'LoadImage' && !imageNodeId) imageNodeId = nid
    if (!seedNodeId) {
      for (const [k, v] of Object.entries<any>(inputs)) {
        if (typeof v === 'number' && /seed/i.test(k)) {
          seedNodeId = nid
          seedKey = k
          break
        }
      }
    }
  }
  if (!imageNodeId) throw createError({ statusCode: 400, message: '工作流里没有 LoadImage 输入节点' })

  const job = createBatch({
    workflow,
    baseOverrides,
    imageNodeId,
    images,
    batch,
    randSeed,
    fixedSeed,
    seedNodeId,
    seedKey,
    clientId
  })

  // 异步启动 runloop（不 await，返回后前端轮询/SSE 获取进度）
  runBatchLoop(job).catch((e) => {
    console.error('batch runloop error', job.id, e)
    job.finishedAt = Date.now()
  })

  return getBatchInfo(job.id)
})

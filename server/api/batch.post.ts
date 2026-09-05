// 创建批量任务（每张图 × 批次，逐单自动连发）
import { createBatch, enqueueBatchRun, getBatchInfo } from '../utils/batch'
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

  // 定位 image / seed 节点（多 LoadImage 工作流：按节点标题自然排序作为槽位顺序）
  const graphRes = readWorkflowFile(workflow)
  if (!graphRes.ok) throw createError({ statusCode: 400, message: graphRes.error })
  const graph = graphRes.graph as any

  const imageNodes: { id: string; title: string }[] = []
  let seedNodeId: string | null = null
  let seedKey: string | null = null

  for (const [nid, node] of Object.entries<any>(graph || {})) {
    const ct = String(node?.class_type || '')
    const inputs = node?.inputs || {}
    if (ct === 'LoadImage') {
      imageNodes.push({ id: nid, title: String(node?._meta?.title || nid) })
    }
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
  if (!imageNodes.length) throw createError({ statusCode: 400, message: '工作流里没有 LoadImage 输入节点' })
  imageNodes.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN', { numeric: true }))
  const imageNodeIds = imageNodes.map((n) => n.id)

  // 多槽位：图片按槽位数分组，凑不满一组的尾巴不参与
  if (imageNodeIds.length > 1 && images.length < imageNodeIds.length) {
    throw createError({
      statusCode: 400,
      message: `该工作流每单需要 ${imageNodeIds.length} 张参考图（${imageNodes.map((n) => n.title).join(' / ')}），当前只有 ${images.length} 张`
    })
  }

  const job = createBatch({
    workflow,
    baseOverrides,
    imageNodeIds,
    images,
    batch,
    randSeed,
    fixedSeed,
    seedNodeId,
    seedKey,
    clientId
  })

  // 异步启动 runloop（全局串行链：后提交的批次排队，依次执行）
  enqueueBatchRun(job)

  return getBatchInfo(job.id)
})

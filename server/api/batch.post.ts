// 直接提交生成任务到 ComfyUI 原生队列（不再维护本地批次状态机）
//
// 流程：构造成 N 个任务的图 → 逐个 POST /prompt → 记录 promptId 快照
// 任务状态一律由 ComfyUI 自己管理（/queue 看排队运行、/history 看完成产出）
import { comfyBase, readWorkflowFile, formatNodeErrors } from '../utils/comfy'
import { saveJobSnapshot, pruneJobMetas } from '../utils/jobsnap'

/** 按工作流定义找出图片槽位与 seed 节点（与预检/前端复用保持一致） */
function analyzeGraph(graph: any) {
  const imageSlots: { id: string; title: string }[] = []
  let seedNodeId: string | null = null
  let seedKey: string | null = null
  for (const [nid, node] of Object.entries<any>(graph || {})) {
    const ct = String(node?.class_type || '')
    if (ct === 'LoadImage') imageSlots.push({ id: nid, title: String(node?._meta?.title || nid) })
    if (!seedNodeId) {
      for (const [k, v] of Object.entries<any>(node?.inputs || {})) {
        if (typeof v === 'number' && /seed/i.test(k)) { seedNodeId = nid; seedKey = k; break }
      }
    }
  }
  imageSlots.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN', { numeric: true }))
  return { imageSlots, seedNodeId, seedKey }
}

export default defineEventHandler(async (event) => {
  const body: any = await readBody(event).catch(() => ({}))
  const workflow = String(body?.workflow || '')
  const images: string[] = (body?.images || []).filter((x: unknown) => typeof x === 'string')
  const batch = Math.max(1, Math.min(50, Math.floor(Number(body?.batch) || 1)))
  const randSeed = body?.randSeed !== false
  const fixedSeed = body?.fixedSeed != null ? Number(body?.fixedSeed) : null
  const firstSeed = body?.firstSeed != null ? Number(body?.firstSeed) : null
  const clientId = String(body?.clientId || '')
  const baseOverrides: Record<string, Record<string, any>> = body?.baseOverrides || {}

  if (!workflow) throw createError({ statusCode: 400, message: '缺少工作流' })
  if (!images.length) throw createError({ statusCode: 400, message: '至少需要一张参考图' })

  const res = readWorkflowFile(workflow)
  if (!res.ok) throw createError({ statusCode: 400, message: res.error })
  const baseGraph = res.graph as any
  const { imageSlots, seedNodeId, seedKey } = analyzeGraph(baseGraph)
  if (!imageSlots.length) throw createError({ statusCode: 400, message: '工作流里没有 LoadImage 输入节点' })

  const base = comfyBase()

  /** 按槽位顺序填入参考图，并移除未使用的槽位及其连线 */
  function buildGraph(imgs: string[], seed: number | null) {
    const graph = structuredClone(baseGraph)
    for (const [nid, fields] of Object.entries<any>(baseOverrides)) {
      if (graph[nid]) graph[nid].inputs = { ...graph[nid].inputs, ...fields }
    }
    const used = new Set<string>()
    imageSlots.forEach((slot, i) => {
      if (imgs[i]) { graph[slot.id].inputs.image = imgs[i]; used.add(slot.id) }
    })
    const unused = imageSlots.filter((s) => !used.has(s.id)).map((s) => s.id)
    if (unused.length) {
      const set = new Set(unused)
      for (const node of Object.values<any>(graph)) {
        const inputs = node?.inputs
        if (!inputs || typeof inputs !== 'object') continue
        for (const [k, v] of Object.entries<any>(inputs)) if (Array.isArray(v) && set.has(String(v[0]))) delete inputs[k]
      }
      for (const nid of unused) delete graph[nid]
    }
    if (seed !== null && seedNodeId && seedKey && graph[seedNodeId]) {
      graph[seedNodeId].inputs[seedKey] = seed
    }
    return graph
  }

  // 任务展开：多图时每张图为独立任务（与原来「每张图 × 批次」的语义一致）
  const tasks: { image: string; images: string[]; seed: number | null }[] = []
  const groups = imageSlots.length > 1 && images.length > imageSlots.length
    ? Array.from({ length: Math.floor(images.length / imageSlots.length) }, (_, g) =>
        images.slice(g * imageSlots.length, (g + 1) * imageSlots.length))
    : images.map((im) => [im])
  for (const group of groups) {
    for (let b = 0; b < batch; b++) {
      tasks.push({
        image: group[0],
        images: group,
        seed: randSeed ? Math.floor(Math.random() * 1e15) : fixedSeed
      })
    }
  }
  // 一次性复用种子：仅作用于第一个任务
  if (firstSeed != null && Number.isFinite(firstSeed) && tasks[0]) tasks[0].seed = firstSeed

  pruneJobMetas()

  const submitted: { promptId: string; image: string; seed: number | null }[] = []
  const errors: { image: string; error: string }[] = []

  for (const [idx, t] of tasks.entries()) {
    const graph = buildGraph(t.images, t.seed)
    let promptRes: any = null
    try {
      promptRes = await $fetch(`${base}/prompt`, {
        method: 'POST',
        body: { prompt: graph, client_id: clientId },
        timeout: 30000
      })
    } catch (e: any) {
      const data = e?.data || e?.response?._data
      // 校验失败时 ComfyUI 在 body 里带 node_errors
      if (data?.node_errors) {
        errors.push({ image: t.image, error: formatNodeErrors(data.node_errors, graph) })
        continue
      }
      errors.push({ image: t.image, error: `提交失败：${e?.data?.error?.message || e?.message || e}` })
      continue
    }
    // 关键陷阱：校验失败也会返回 prompt_id，必须查 node_errors
    if (promptRes?.node_errors && Object.keys(promptRes.node_errors).length) {
      errors.push({ image: t.image, error: formatNodeErrors(promptRes.node_errors, graph) })
      continue
    }
    if (!promptRes?.prompt_id) {
      errors.push({ image: t.image, error: `提交失败：${JSON.stringify(promptRes).slice(0, 200)}` })
      continue
    }
    saveJobSnapshot({
      promptId: promptRes.prompt_id,
      workflow,
      images: t.images,
      seed: t.seed,
      itemIndex: idx + 1,
      itemTotal: tasks.length,
      baseOverrides,
      submittedAt: Date.now()
    })
    submitted.push({ promptId: promptRes.prompt_id, image: t.image, seed: t.seed })
  }

  if (!submitted.length) {
    throw createError({
      statusCode: 400,
      message: errors.length ? `全部 ${tasks.length} 个任务提交失败：${errors[0].error}` : '提交失败（无有效任务）'
    })
  }

  return {
    ok: true,
    submitted: submitted.length,
    failed: errors.length,
    total: tasks.length,
    promptIds: submitted.map((s) => s.promptId),
    errors,
    workflow
  }
})

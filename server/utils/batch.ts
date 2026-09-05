// comfyBase / readWorkflowFile / normalizeOutputs 由 Nuxt 对 server/utils 自动导入

// ------- 常量 -------
const POLL_MS = 1000        // 轮询单 prompt 完成间隔
const MAX_ITEM_MS = 15 * 60 * 1000
const AUTO_POLL_INTERVAL = 4000 // runloop 主动轮询已提交 items 的间隔

export interface BatchItem {
  id: string
  image: string        // 该单使用的第一张参考图（兼容展示）
  images?: string[]    // 多图槽位工作流：该单使用的全部参考图（按槽位顺序）
  seed: number | null
  status: 'pending' | 'running' | 'done' | 'error'
  promptId?: string
  outputs: { filename: string; subfolder: string; type: string; kind: string }[]
  error?: string
  durationMs?: number  // 该单生成耗时（提交成功 → 完成/失败）
}

export interface BatchJob {
  id: string
  workflow: string
  baseOverrides: Record<string, Record<string, any>>
  imageNodeIds: string[]    // LoadImage 节点 id（按槽位顺序；单图工作流长度为 1）
  seedNodeId: string | null // seed 字段所在节点 id
  seedKey: string | null
  images: string[]
  batch: number
  randSeed: boolean
  clientId: string
  items: BatchItem[]
  startedAt: number
  loopStarted?: boolean
  finishedAt?: number
  cancelled?: boolean
}

const jobs = new Map<string, BatchJob>()

export function genId(prefix = 'b') {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function getBatchInfo(id: string) {
  const j = jobs.get(id)
  if (!j) return null
  return {
    id: j.id,
    workflow: j.workflow,
    randSeed: j.randSeed,
    images: j.images,
    batch: j.batch,
    startedAt: j.startedAt,
    loopStarted: !!j.loopStarted,
    finishedAt: j.finishedAt,
    cancelled: j.cancelled,
    items: j.items.map((it) => ({
      id: it.id,
      image: it.image,
      images: it.images || [it.image],
      seed: it.seed,
      status: it.status,
      promptId: it.promptId,
      error: it.error,
      durationMs: it.durationMs,
      outputCount: it.outputs.length
    })),
    slotCount: j.imageNodeIds.length
  }
}

export function batchExists(id: string) {
  return jobs.has(id)
}

export function stopBatch(id: string) {
  const j = jobs.get(id)
  if (j) j.cancelled = true
}

export function disposeBatch(id: string) {
  jobs.delete(id)
}

/** 预生成 items 顺序 = images × batch（每张图跑 batch 单，每单一个独立 seed） */
/** 预生成 items 顺序：
 *  单图槽位工作流 = images × batch（每张图跑 batch 单，每单一个独立 seed）
 *  多图槽位工作流 = 每 slots 张图为一组（末组允许不满额），每组跑 batch 单 */
function planItems(job: BatchJob) {
  const slots = Math.max(1, job.imageNodeIds?.length || 1)
  const groups: string[][] = []
  if (slots === 1) {
    for (const img of job.images) groups.push([img])
  } else {
    for (let i = 0; i < job.images.length; i += slots) {
      groups.push(job.images.slice(i, i + slots))
    }
  }
  for (const g of groups) {
    for (let n = 0; n < job.batch; n++) {
      job.items.push({
        id: genId('t'),
        image: g[0],
        images: g,
        seed: job.randSeed ? Math.floor(Math.random() * 1e15) : null,
        status: 'pending',
        outputs: []
      })
    }
  }
}

export interface CreateBatchInput {
  workflow: string
  baseOverrides: Record<string, Record<string, any>>
  imageNodeIds: string[]
  images: string[]
  batch: number
  randSeed: boolean
  fixedSeed: number | null
  seedNodeId: string | null
  seedKey: string | null
  clientId: string
}

/** 创建批量任务（不立即跑，交给 /batch 的 runloop / SSE 触发） */
export function createBatch(input: CreateBatchInput) {
  const job: BatchJob = {
    id: genId('batch'),
    workflow: input.workflow,
    baseOverrides: structuredClone(input.baseOverrides),
    imageNodeIds: input.imageNodeIds,
    seedNodeId: input.seedNodeId,
    seedKey: input.seedKey,
    images: input.images,
    batch: Math.max(1, input.batch),
    randSeed: input.randSeed,
    clientId: input.clientId,
    startedAt: Date.now(),
    items: []
  }
  // 固定种子模式：所有单共用 fixedSeed
  planItems(job)
  if (!job.randSeed) {
    for (const it of job.items) it.seed = input.fixedSeed ?? null
  }
  jobs.set(job.id, job)
  return job
}

function buildGraph(job: BatchJob, item: BatchItem): { ok: true; graph: any } | { ok: false; error: string } {
  const res = readWorkflowFile(job.workflow)
  if (!res.ok) return res
  const graph = structuredClone(res.graph) as any
  // 应用基础覆盖
  for (const [nid, fields] of Object.entries<any>(job.baseOverrides)) {
    if (!graph[nid]) continue
    graph[nid].inputs = { ...graph[nid].inputs, ...fields }
  }
  // 覆盖 image（多槽位按组填充：Picture 1/2/3 依次对应一组参考图）
  const imgs = item.images || [item.image]
  const used = new Set<string>()
  job.imageNodeIds.forEach((nid, i) => {
    if (imgs[i] && graph[nid]) {
      graph[nid].inputs.image = imgs[i]
      used.add(nid)
    }
  })
  // 未启用的槽位：删除图中对该 LoadImage 的引用输入（如 ref_images.ref_image_N），并删除节点本身
  // —— 这样新增几张参考图就只启用几个 Picture 槽位，其余槽位完全不参与执行
  const unusedSlots = job.imageNodeIds.filter((nid) => !used.has(nid))
  if (unusedSlots.length) {
    const unusedSet = new Set(unusedSlots)
    for (const node of Object.values<any>(graph)) {
      const inputs = node?.inputs
      if (!inputs || typeof inputs !== 'object') continue
      for (const [k, v] of Object.entries<any>(inputs)) {
        if (Array.isArray(v) && unusedSet.has(String(v[0]))) delete inputs[k]
      }
    }
    for (const nid of unusedSlots) delete graph[nid]
  }
  // 覆盖 seed
  if (item.seed !== null && job.seedNodeId && job.seedKey && graph[job.seedNodeId]) {
    graph[job.seedNodeId].inputs[job.seedKey] = item.seed
  }
  return { ok: true, graph }
}

/** 提交单张图，等待完成后回填 outputs */
export async function runItem(job: BatchJob, item: BatchItem) {
  const base = comfyBase()
  if (!item.image) {
    item.status = 'error'
    item.error = '缺少参考图，已跳过'
    return
  }
  const g = buildGraph(job, item)
  if (!g.ok) {
    item.status = 'error'
    item.error = g.error
    return
  }
  item.status = 'running'
  // 提交 /prompt：瞬时网络抖动做指数重试，避免一次抖动毁掉整批
  let promptRes: any
  let lastErr: any = null
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (job.cancelled) {
      item.status = 'pending'
      return
    }
    try {
      promptRes = await $fetch(`${base}/prompt`, {
        method: 'POST',
        body: { prompt: g.graph, client_id: job.clientId },
        timeout: 30000
      })
      break
    } catch (e: any) {
      lastErr = e
      if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 1500))
    }
  }
  if (!promptRes?.prompt_id) {
    item.status = 'error'
    item.error = `提交失败：${lastErr?.data?.error?.message || lastErr?.message || lastErr}`
    return
  }
  item.promptId = promptRes.prompt_id
  const pid = item.promptId
  const start = Date.now()
  item.durationMs = undefined
  // 轮询完成（阻塞该 item，直到成功/失败/取消）
  for (;;) {
      if (job.cancelled) {
        item.status = 'pending' // 标记为未完成，由 runloop 略过
        return
      }
      if (Date.now() - start > MAX_ITEM_MS) {
        item.status = 'error'
        item.error = '执行超时'
        item.durationMs = Date.now() - start
        return
      }
      try {
        const h: any = await $fetch(`${base}/history/${pid}`, { timeout: 5000 })
        const entry = h?.[pid]
        if (entry?.status?.status_str === 'success' || entry?.status?.completed) {
          item.status = 'done'
          item.outputs = normalizeOutputs(entry)
          item.durationMs = Date.now() - start
          return
        }
        if (entry?.status?.status_str === 'error') {
          item.status = 'error'
          item.durationMs = Date.now() - start
          item.error =
            entry?.status?.messages?.map((m: any) => (Array.isArray(m) ? m[1] : m)).join('; ') || '执行失败'
          return
        }
      } catch {
        /* 网络抖动，继续轮询 */
      }
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
}

/** 批次依次执行：后提交的批次排队，等前面的批次全部跑完再开始（ComfyUI 队列语义） */
let runChain: Promise<void> = Promise.resolve()
export function enqueueBatchRun(job: BatchJob) {
  runChain = runChain
    .then(() => {
      if (job.cancelled) { job.finishedAt = Date.now(); return }
      job.loopStarted = true
      return runBatchLoop(job)
    })
    .catch((e) => {
      console.error('batch runloop error', job.id, e)
      if (!job.finishedAt) job.finishedAt = Date.now()
    })
}

/** runloop：逐个拿 pending/running item，直到全部非 pending 或取消 */
export async function runBatchLoop(job: BatchJob) {
  while (!job.cancelled) {
    const item = job.items.find((it) => it.status === 'pending')
    if (!item) break
    await runItem(job, item)
    if (job.cancelled) break
  }
  if (job.cancelled) {
    // 把 pending 的置 skipped 视觉（无此态则保持 pending）
    for (const it of job.items) if (it.status === 'pending') it.status = 'pending'
  }
  job.finishedAt = Date.now()
}

export function batchRunningCount(job: BatchJob) {
  return job.items.filter((it) => it.status === 'running' || it.status === 'pending').length
}
export function batchDoneCount(job: BatchJob) {
  return job.items.filter((it) => it.status === 'done').length
}
export function batchErrorCount(job: BatchJob) {
  return job.items.filter((it) => it.status === 'error').length
}

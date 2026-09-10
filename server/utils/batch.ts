// comfyBase / readWorkflowFile / normalizeOutputs 由 Nuxt 对 server/utils 自动导入
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ------- 常量 -------
const POLL_MS = 1000        // 轮询单 prompt 完成间隔
const MAX_ITEM_MS = 15 * 60 * 1000
const RECONCILE_FAILS = 10  // 连续轮询失败 N 次后，主动查 /queue 对账

// ------- 磁盘持久化（Nitro dev 热重载会清空内存，必须落盘才能恢复） -------
const PERSIST_DIR = join(process.cwd(), 'data', 'batches')
function persistJob(job: BatchJob) {
  if (job.cancelled) return // 已取消的批次不留磁盘文件（停止 = 丢弃）
  try {
    mkdirSync(PERSIST_DIR, { recursive: true })
    writeFileSync(join(PERSIST_DIR, `${job.id}.json`), JSON.stringify(job), 'utf-8')
  } catch { /* 落盘失败不阻断执行 */ }
}
function removePersisted(id: string) {
  try { unlinkSync(join(PERSIST_DIR, `${id}.json`)) } catch { /* 忽略 */ }
}

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

/** 全部批次摘要（诊断用） */
export function allBatchSummaries() {
  return [...jobs.values()].map((j) => ({
    id: j.id,
    workflow: j.workflow,
    loopStarted: !!j.loopStarted,
    finishedAt: j.finishedAt,
    cancelled: j.cancelled,
    items: j.items.map((it) => ({ id: it.id, status: it.status, promptId: it.promptId, error: it.error }))
  }))
}

export function stopBatch(id: string) {
  const j = jobs.get(id)
  if (j) {
    j.cancelled = true
    removePersisted(id) // 停止 = 丢弃，磁盘文件一并清理
  }
}

export function disposeBatch(id: string) {
  jobs.delete(id)
  removePersisted(id)
}

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
  firstSeed: number | null // 一次性：仅第一单用这个 seed（资产复用），其余单按 randSeed
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
  // 一次性复用种子：仅覆盖第一单（randSeed 模式下其余单仍随机）
  if (input.firstSeed != null && Number.isFinite(input.firstSeed) && job.items[0]) {
    job.items[0].seed = input.firstSeed
  }
  jobs.set(job.id, job)
  persistJob(job)
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

/** 提交 /prompt：瞬时网络抖动指数重试；外层再加硬超时竞赛，防止连接悬挂把整条链卡死 */
async function submitPrompt(base: string, graph: any, clientId: string): Promise<any> {
  let lastErr: any = null
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await Promise.race([
        $fetch(`${base}/prompt`, {
          method: 'POST',
          body: { prompt: graph, client_id: clientId },
          timeout: 20000
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('提交响应超时（35s 无响应）')), 35000))
      ])
    } catch (e: any) {
      lastErr = e
      if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 1500))
    }
  }
  throw lastErr
}

/** 轮询单个 prompt 直到成功/失败/取消/超时；带队列对账看门狗 */
async function pollUntilDone(job: BatchJob, item: BatchItem) {
  const base = comfyBase()
  const pid = item.promptId!
  const start = Date.now()
  let failStreak = 0
  for (;;) {
    if (job.cancelled) {
      item.status = 'pending' // 标记为未完成，由 runloop 略过
      return
    }
    if (Date.now() - start > MAX_ITEM_MS) {
      item.status = 'error'
      item.error = '执行超时'
      item.durationMs = Date.now() - start
      persistJob(job)
      return
    }
    // —— 对账看门狗：连续失败 N 次（网络断/ComfyUI 卡死）后主动查 /queue ——
    if (failStreak > 0 && failStreak % RECONCILE_FAILS === 0) {
      try {
        const q: any = await $fetch(`${base}/queue`, { timeout: 8000 })
        const inQueue = [...(q?.queue_running || []), ...(q?.queue_pending || [])]
          .some((it: any) => Array.isArray(it) && it[1] === pid)
        if (!inQueue) {
          // 不在队列了：任务要么已完成要么已丢失，再查一次历史定论
          try {
            const h2: any = await $fetch(`${base}/history/${pid}`, { timeout: 8000 })
            const e2 = h2?.[pid]
            if (e2?.status?.status_str === 'success' || e2?.status?.completed) {
              item.status = 'done'
              item.outputs = normalizeOutputs(e2)
              item.durationMs = Date.now() - start
              persistJob(job)
              return
            }
          } catch { /* 历史也查不到，按丢失处理 */ }
          item.status = 'error'
          item.durationMs = Date.now() - start
          item.error = '任务丢失：ComfyUI 队列与历史中都找不到该任务（可能已重启或被清除）'
          persistJob(job)
          return
        }
      } catch { /* 对账请求本身失败，继续普通轮询 */ }
    }
    try {
      const h: any = await $fetch(`${base}/history/${pid}`, { timeout: 5000 })
      failStreak = 0
      const entry = h?.[pid]
      if (entry?.status?.status_str === 'success' || entry?.status?.completed) {
        item.status = 'done'
        item.outputs = normalizeOutputs(entry)
        item.durationMs = Date.now() - start
        persistJob(job)
        return
      }
      if (entry?.status?.status_str === 'error') {
        item.status = 'error'
        item.durationMs = Date.now() - start
        // 提取可读错误：优先 exception_message，避免 [object Object]
        const msgs: any[] = entry?.status?.messages || []
        item.error =
          msgs
            .map((m: any) => {
              const body = Array.isArray(m) ? m[1] : m
              if (typeof body === 'string') return body
              return body?.exception_message || body?.exception_type || JSON.stringify(body)?.slice(0, 200) || '执行失败'
            })
            .filter(Boolean)
            .join('; ') || '执行失败'
        persistJob(job)
        return
      }
    } catch {
      failStreak++ /* 网络抖动，继续轮询 */
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

/** 提交单张图，等待完成后回填 outputs */
export async function runItem(job: BatchJob, item: BatchItem) {
  const base = comfyBase()
  if (!item.image) {
    item.status = 'error'
    item.error = '缺少参考图，已跳过'
    persistJob(job)
    return
  }
  const g = buildGraph(job, item)
  if (!g.ok) {
    item.status = 'error'
    item.error = g.error
    persistJob(job)
    return
  }
  item.status = 'running'
  // 提交 /prompt：瞬时网络抖动做指数重试，避免一次抖动毁掉整批
  let promptRes: any = null
  try {
    promptRes = await submitPrompt(base, g.graph, job.clientId)
  } catch (e: any) {
    item.status = 'error'
    item.error = `提交失败：${e?.data?.error?.message || e?.message || e}`
    persistJob(job)
    return
  }
  if (!promptRes?.prompt_id) {
    item.status = 'error'
    item.error = `提交失败：${JSON.stringify(promptRes).slice(0, 200)}`
    persistJob(job)
    return
  }
  item.promptId = promptRes.prompt_id
  persistJob(job)
  await pollUntilDone(job, item)
}

/** 批次依次执行：后提交的批次排队，等前面的批次全部跑完再开始（ComfyUI 队列语义） */
let runChain: Promise<void> = Promise.resolve()
export function enqueueBatchRun(job: BatchJob) {
  runChain = runChain
    .then(() => {
      if (job.cancelled) { if (!job.finishedAt) { job.finishedAt = Date.now(); persistJob(job) } return }
      job.loopStarted = true
      persistJob(job)
      return runBatchLoop(job)
    })
    .catch((e) => {
      console.error('batch runloop error', job.id, e)
      if (!job.finishedAt) { job.finishedAt = Date.now(); persistJob(job) }
    })
}

/** runloop：逐个拿 pending/running item，直到全部完成或取消 */
export async function runBatchLoop(job: BatchJob) {
  while (!job.cancelled) {
    const item = job.items.find((it) => it.status === 'pending')
    if (item) {
      await runItem(job, item)
      continue
    }
    // 没有 pending 了：若有「运行中但带 promptId」的（服务重启恢复的场景），继续盯完它
    const running = job.items.find((it) => it.status === 'running' && it.promptId)
    if (running) {
      await pollUntilDone(job, running)
      continue
    }
    break
  }
  if (!job.items.some((it) => it.status === 'pending' || it.status === 'running') || job.cancelled) {
    job.finishedAt = job.finishedAt || Date.now()
    if (job.cancelled) removePersisted(job.id)
    else persistJob(job)
  }
}

// ------- 启动恢复：读取落盘批次，未完成的按提交顺序重新入链 -------
function restorePersistedJobs() {
  try {
    if (!existsSync(PERSIST_DIR)) return
    const files = readdirSync(PERSIST_DIR).filter((f) => f.endsWith('.json'))
    const restored: BatchJob[] = []
    const DAY_MS = 24 * 60 * 60 * 1000
    for (const f of files) {
      try {
        const j = JSON.parse(readFileSync(join(PERSIST_DIR, f), 'utf-8')) as BatchJob
        if (!j?.id || !Array.isArray(j.items)) continue
        // 已结束超过 24h 的批次文件直接清掉，防无限累积
        if ((j.finishedAt || j.startedAt) < Date.now() - DAY_MS) {
          removePersisted(j.id)
          continue
        }
        // 恢复时：running 但没提交成功过（无 promptId）→ 回退 pending 重跑
        for (const it of j.items) {
          if (it.status === 'running' && !it.promptId) it.status = 'pending'
        }
        jobs.set(j.id, j)
        if (!j.finishedAt && !j.cancelled) restored.push(j)
      } catch { /* 单个文件损坏忽略 */ }
    }
    restored.sort((a, b) => a.startedAt - b.startedAt).forEach((j) => enqueueBatchRun(j))
    if (restored.length) console.log(`[batch] 已恢复 ${restored.length} 个未完成批次（服务重启前遗留）`)
  } catch { /* 恢复失败不阻断服务 */ }
}
restorePersistedJobs()

export function batchRunningCount(job: BatchJob) {
  return job.items.filter((it) => it.status === 'running' || it.status === 'pending').length
}
export function batchDoneCount(job: BatchJob) {
  return job.items.filter((it) => it.status === 'done').length
}
export function batchErrorCount(job: BatchJob) {
  return job.items.filter((it) => it.status === 'error').length
}

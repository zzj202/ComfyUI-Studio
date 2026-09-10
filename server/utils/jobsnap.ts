// 提交快照存储：promptId → 平台侧展示元数据
//
// 为什么需要它：ComfyUI 原生 API（/queue、/history）不返回「用的是哪个工作流/
// 哪张参考图/什么 seed」这类业务信息，而这些正是界面要展示、以及「复用全部参数」
// 要还原的内容。所以在提交时按 promptId 落一份小快照旁挂存储。
//
// 注意：这不是「批次管理系统」——没有状态机、没有轮询、没有批次概念，
// 只是 一张 promptId → 元数据 的字典。任务状态一律以 ComfyUI 原生 API 为准。
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SNAP_DIR = join(process.cwd(), 'data', 'jobs')
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000 // 快照保留 14 天
const MAX_FILES = 800

export interface JobSnapshot {
  promptId: string
  workflow: string
  workflowName?: string
  images: string[]
  seed: number | null
  batchId?: string
  itemIndex?: number
  itemTotal?: number
  baseOverrides?: Record<string, Record<string, any>>
  submittedAt: number
}

function ensureDir() {
  try { mkdirSync(SNAP_DIR, { recursive: true }) } catch { /* 忽略 */ }
}

export function saveJobSnapshot(snap: JobSnapshot) {
  if (!snap?.promptId) return
  ensureDir()
  try {
    writeFileSync(join(SNAP_DIR, `${snap.promptId}.json`), JSON.stringify(snap), 'utf-8')
  } catch { /* 落盘失败不阻断生成 */ }
}

export function readJobMeta(promptId: string): JobSnapshot | null {
  if (!promptId) return null
  try {
    const p = join(SNAP_DIR, `${promptId}.json`)
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch { return null }
}

/** 一次性读出全部快照，作为 promptId → 元数据 的索引（供任务列表批量补全展示信息） */
export function listJobMetas(): Record<string, JobSnapshot> {
  const out: Record<string, JobSnapshot> = {}
  try {
    if (!existsSync(SNAP_DIR)) return out
    for (const f of readdirSync(SNAP_DIR)) {
      if (!f.endsWith('.json')) continue
      try {
        const s = JSON.parse(readFileSync(join(SNAP_DIR, f), 'utf-8'))
        if (s?.promptId) out[s.promptId] = s
      } catch { /* 单条损坏忽略 */ }
    }
  } catch { /* 目录不可读忽略 */ }
  return out
}

/** 清理过期/超量的快照（惰性调用，不做定时器） */
export function pruneJobMetas() {
  try {
    if (!existsSync(SNAP_DIR)) return
    const files = readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json'))
    const now = Date.now()
    const entries: { f: string; t: number }[] = []
    for (const f of files) {
      const p = join(SNAP_DIR, f)
      let t = 0
      try { t = JSON.parse(readFileSync(p, 'utf-8'))?.submittedAt || 0 } catch { /* 损坏 */ }
      if (t && now - t > MAX_AGE_MS) { try { unlinkSync(p) } catch { /* 忽略 */ } }
      else entries.push({ f, t })
    }
    entries.sort((a, b) => b.t - a.t)
    for (const e of entries.slice(MAX_FILES)) {
      try { unlinkSync(join(SNAP_DIR, e.f)) } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
}

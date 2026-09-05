import { join, normalize } from 'node:path'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'

export const comfyBase = () => resolveComfyBase().base

export const workflowsDir = () => join(process.cwd(), 'server', 'workflows')

/** 读取工作流目录中的所有 API 格式 JSON */
export function listWorkflows() {
  const dir = workflowsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const graph = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
        const nodes = Object.values<any>(graph)
        return {
          file: f,
          name: f.replace(/\.json$/, ''),
          nodeCount: nodes.length,
          hasMeta: nodes.some((n: any) => n?._meta?.title)
        }
      } catch {
        return { file: f, name: f.replace(/\.json$/, ''), nodeCount: 0, hasMeta: false, broken: true }
      }
    })
}

/** 按名称安全读取工作流（防路径穿越） */
export function readWorkflowFile(name: string): { ok: true; graph: any } | { ok: false; error: string } {
  const safe = normalize(name).replace(/^([.]{2[\\/])+/, '')
  if (safe.includes('..') || safe.includes('/') || safe.includes('\\')) {
    return { ok: false, error: '非法的工作流名称' }
  }
  const path = join(workflowsDir(), safe.endsWith('.json') ? safe : `${safe}.json`)
  if (!existsSync(path) || !statSync(path).isFile()) {
    return { ok: false, error: `工作流不存在: ${name}` }
  }
  try {
    return { ok: true, graph: JSON.parse(readFileSync(path, 'utf-8')) }
  } catch (e: any) {
    return { ok: false, error: `工作流 JSON 解析失败: ${e.message}` }
  }
}

/** 判断 history 输出条目的媒体类型 */
export function detectKind(item: any, listKey: string): 'video' | 'image' | 'audio' {
  const filename = String(item?.filename || '').toLowerCase()
  const format = String(item?.format || '').toLowerCase()
  if (format.includes('video') || filename.match(/\.(mp4|webm|mov|mkv)$/)) return 'video'
  if (listKey === 'audio' || filename.match(/\.(mp3|wav|flac|ogg|m4a)$/)) return 'audio'
  return 'image'
}

/** 把 ComfyUI history 的 outputs 规范化成统一结构 */
export function normalizeOutputs(historyEntry: any) {
  const outputs: any[] = []
  const nodeOutputs = historyEntry?.outputs || {}
  for (const [nodeId, nodeOut] of Object.entries<any>(nodeOutputs)) {
    for (const listKey of ['images', 'gifs', 'videos', 'audio']) {
      for (const item of nodeOut?.[listKey] || []) {
        outputs.push({
          nodeId,
          listKey,
          kind: detectKind(item, listKey),
          filename: item.filename,
          subfolder: item.subfolder || '',
          type: item.type || 'output'
        })
      }
    }
  }
  return outputs
}

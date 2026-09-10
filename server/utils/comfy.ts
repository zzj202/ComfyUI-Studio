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

/**
 * 把 ComfyUI 的 node_errors 翻译成用户能看懂的中文原因（并带上出错的字段值）
 *
 * 背景（关键陷阱）：ComfyUI 在参数校验失败时（参考图不存在 / 取值不在列表 / 缺必填）
 * 依然会返回 prompt_id，只判断有无 prompt_id 会把它当成成功 → 任务秒完但零产出。
 * 所以提交侧必须显式检查 node_errors 并用本函数给出可读原因。
 */
export function formatNodeErrors(nodeErrors: Record<string, any>, graph: any): string {
  const parts: string[] = []
  for (const [nid, info] of Object.entries<any>(nodeErrors)) {
    const ct = info?.class_type || graph?.[nid]?.class_type || `节点 ${nid}`
    const title = graph?.[nid]?._meta?.title || ct
    for (const err of info?.errors || []) {
      const msg = String(err?.message || '')
      const detail = String(err?.details || '')
      const inputName = err?.extra_info?.input_name || ''
      let hint = ''
      // 常见错误类型 → 可操作提示
      if (/Invalid image file/i.test(detail)) {
        hint = '⚠ 参考图在 ComfyUI 服务器上不存在（可能换过服务器/图未上传）→ 请重新上传参考图'
      } else if (/value_not_in_list/i.test(err?.type || '')) {
        const val = graph?.[nid]?.inputs?.[inputName]
        hint = `⚠ 取值不在服务器的可选项中${inputName ? `（字段 ${inputName}${val ? ` = ${val}` : ''}）` : ''} → 请用下拉列表重新选择（如 LoRA / 模型 / 采样器文件名）`
      } else if (/required input is missing/i.test(detail + msg)) {
        hint = `⚠ 缺少必填输入${inputName ? `（${inputName}）` : ''}`
      }
      parts.push(`[${title}] ${detail || msg}${hint ? `\n    ${hint}` : ''}`)
    }
  }
  return parts.join('\n') || '节点校验失败'
}

// 提交前预检：基于 /object_info 做本地校验（绝不调用 /prompt、绝不入队）
//
// 历史教训：旧版曾用 POST /prompt 让 ComfyUI「只校验不入队」——但 /prompt 校验通过
// 就会直接入队并可能立即被 GPU 拾取，事后再 {delete} 对运行中任务无效 →
// 每次正常提交前都会泄漏 1 个真任务（批次 2 实际入队 3 个）。
// 故改为本地校验：/object_info 拿到每个节点的输入定义，逐项检查
// （节点类型存在 / 必填输入齐全 / 下拉取值在列表内 / 数值范围 / 参考图在服务器文件列表中）。
import { readWorkflowFile, getObjectInfo, getLoadImageList } from '../../utils/comfy'

/** object_info 中标记为 hidden 的特殊输入类型，不参与校验，避免误报 */
const HIDDEN_TYPES = new Set([
  'HIDDEN', 'HOOKS', 'CONTROLS', 'UNIQUE_ID', 'PROMPT', 'EXTRA_PNGINFO',
  'DYNPROMPT', 'AUTH_TOKEN_COMFY_ORG', 'API_KEY_COMFY_ORG'
])

export default defineEventHandler(async (event) => {
  const body: any = await readBody(event).catch(() => ({}))
  const workflow = String(body?.workflow || '')
  const images: string[] = (body?.images || []).filter((x: unknown) => typeof x === 'string')
  const baseOverrides: Record<string, Record<string, any>> = body?.baseOverrides || {}
  if (!workflow) throw createError({ statusCode: 400, message: '缺少工作流' })

  const res = readWorkflowFile(workflow)
  if (!res.ok) throw createError({ statusCode: 400, message: res.error })
  const graph = structuredClone(res.graph) as any

  // 应用参数覆盖（与提交时一致）
  for (const [nid, fields] of Object.entries<any>(baseOverrides)) {
    if (!graph[nid]) continue
    graph[nid].inputs = { ...graph[nid].inputs, ...fields }
  }

  // 参考图槽位：按标题排序，前 N 个填入上传的图，其余槽位剔除（与 buildGraph 同逻辑）
  const slots = Object.entries<any>(graph)
    .filter(([, n]) => n?.class_type === 'LoadImage')
    .map(([nid, n]) => ({ nid, title: String(n?._meta?.title || nid) }))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN', { numeric: true }))

  const used = new Set<string>()
  slots.forEach((s, i) => { if (images[i]) { graph[s.nid].inputs.image = images[i]; used.add(s.nid) } })
  const unused = slots.filter(s => !used.has(s.nid)).map(s => s.nid)
  if (unused.length) {
    const set = new Set(unused)
    for (const node of Object.values<any>(graph)) {
      const inputs = node?.inputs
      if (!inputs || typeof inputs !== 'object') continue
      for (const [k, v] of Object.entries<any>(inputs)) if (Array.isArray(v) && set.has(String(v[0]))) delete inputs[k]
    }
    for (const nid of unused) delete graph[nid]
  }

  // 节点定义走缓存（首次约 1-3s，之后毫秒级）→ 提交按钮不再被预检拖住数秒
  let oi: Record<string, any>
  try {
    oi = await getObjectInfo()
  } catch (e: any) {
    return { ok: false, error: `无法获取 ComfyUI 节点定义：${e?.message || e}`, problems: [] }
  }
  // LoadImage 的图片列表每次现拉：新上传的参考图立刻能通过预检（10 分钟缓存里还没有它）
  const freshImageList = await getLoadImageList()

  const problems: { node: string; title: string; message: string; hint: string; value?: string }[] = []
  const push = (nid: string, node: any, message: string, hint: string, value?: string) => {
    problems.push({
      node: nid,
      title: String(node?._meta?.title || node?.class_type || `节点 ${nid}`),
      message, hint, value
    })
  }

  for (const [nid, node] of Object.entries<any>(graph)) {
    const ct = String(node?.class_type || '')
    const def = oi[ct]
    if (!def) {
      push(nid, node, `节点类型 ${ct} 不在服务器上`, '该工作流依赖的节点未安装，请安装对应插件或更换工作流')
      continue
    }
    const required = def?.input?.required || {}
    const inputs = node?.inputs || {}
    for (const [name, spec] of Object.entries<any>(required)) {
      const typeStr = String(Array.isArray(spec?.[0]) ? 'COMBO' : spec?.[0] || '')
      if (HIDDEN_TYPES.has(typeStr)) continue
      const cfg = (Array.isArray(spec) && spec[1]) || {}
      const v = inputs[name]

      if (v === undefined) {
        // 原始类型：有默认值交给 ComfyUI 填，否则算缺失
        const primitive = typeStr === 'COMBO' || ['INT', 'FLOAT', 'STRING', 'BOOLEAN'].includes(typeStr)
        // 动态/连线类型：实际输入可能是 name.a 这类子键（如 COMFY_AUTOGROW_V3），找不到同名或 name.* 才算缺失
        const dynPresent = Object.keys(inputs).some(k => k === name || k.startsWith(name + '.'))
        if (primitive) {
          if (cfg.default === undefined) push(nid, node, `缺少必填输入 ${name}`, '缺少必填输入', '')
        } else if (!dynPresent) {
          push(nid, node, `缺少必填输入 ${name}`, '缺少必填输入', '')
        }
        continue
      }

      // 下拉列表校验（LoRA 名、模型名、参考图文件名等都属于 combo）
      if (Array.isArray(spec?.[0]) && typeof v === 'string' && !Array.isArray(v)) {
        const isImage = ct === 'LoadImage' && name === 'image'
        // 参考图列表用现拉的（缓存里没有新上传的图）；现拉失败则退回缓存列表
        const list: string[] = isImage && freshImageList.length ? freshImageList : spec[0].map(String)
        if (!list.includes(v)) {
          push(
            nid, node,
            isImage ? `参考图 "${v}" 不在服务器文件列表中` : `${name} 取值 "${v}" 不在服务器可选项中`,
            isImage ? '参考图在 ComfyUI 服务器上不存在，请重新上传参考图'
                    : `取值不在服务器可选项中，请用下拉列表重新选择（${name}）`,
            v
          )
        }
        continue
      }

      // 数值范围校验
      if (typeof v === 'number' && (typeStr === 'INT' || typeStr === 'FLOAT')) {
        if (cfg?.min != null && v < Number(cfg.min)) push(nid, node, `${name}=${v} 低于最小值 ${cfg.min}`, `请把 ${name} 调到 ${cfg.min} 以上`, String(v))
        else if (cfg?.max != null && v > Number(cfg.max)) push(nid, node, `${name}=${v} 超过最大值 ${cfg.max}`, `请把 ${name} 调到 ${cfg.max} 以下`, String(v))
      }
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    checked: { slotCount: slots.length, imageCount: images.length, nodeCount: Object.keys(graph).length }
  }
})

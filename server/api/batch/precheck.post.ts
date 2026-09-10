// 提交前预检：把当前参数构造成的图交给 ComfyUI /prompt 做校验（不真正入队）
// 用于在点击「开始批量生成」前就发现「参考图不存在 / LoRA 不在可选列表 / 缺必填输入」等问题
import { readWorkflowFile } from '../../utils/comfy'

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

  // 交给 ComfyUI 校验：/prompt 会返回 node_errors；这里不关心 prompt_id（真校验、不入队则立即丢弃）
  const base = comfyBase()
  let promptRes: any = null
  try {
    promptRes = await $fetch(`${base}/prompt`, {
      method: 'POST',
      body: { prompt: graph, client_id: 'precheck' },
      timeout: 20000
    })
  } catch (e: any) {
    // 校验失败时 ComfyUI 可能返回 400 + node_errors 在 body 里
    const data = e?.data || e?.response?._data
    if (data?.node_errors) promptRes = data
    else return { ok: false, error: e?.data?.error?.message || e?.message || String(e), problems: [] }
  }

  // 校验通过 → 立刻从队列里移除，避免脏任务堆积
  if (promptRes?.prompt_id) {
    await $fetch(`${base}/queue`, { method: 'POST', body: { delete: [promptRes.prompt_id] }, timeout: 8000 }).catch(() => {})
  }

  const nodeErrors = promptRes?.node_errors || {}
  const problems: { node: string; title: string; message: string; hint: string; value?: string }[] = []
  for (const [nid, info] of Object.entries<any>(nodeErrors)) {
    const title = graph?.[nid]?._meta?.title || info?.class_type || `节点 ${nid}`
    for (const err of info?.errors || []) {
      const msg = String(err?.message || '')
      const detail = String(err?.details || '')
      const inputName = err?.extra_info?.input_name || ''
      let hint = '请检查该参数'
      if (/Invalid image file/i.test(detail)) hint = '参考图在 ComfyUI 服务器上不存在，请重新上传参考图'
      else if (/value_not_in_list/i.test(err?.type || '')) hint = `取值不在服务器可选项中，请用下拉列表重新选择${inputName ? `（${inputName}）` : ''}`
      else if (/required input is missing/i.test(detail + msg)) hint = '缺少必填输入'
      problems.push({
        node: nid, title, message: detail || msg, hint,
        value: inputName ? String(graph?.[nid]?.inputs?.[inputName] ?? '') : ''
      })
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    checked: { slotCount: slots.length, imageCount: images.length, nodeCount: Object.keys(graph).length }
  }
})

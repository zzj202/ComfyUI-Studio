// 读取某个资产提交时的完整工作流图（ComfyUI history 里存有提交的 API 图），用于一键复用全部参数
// 两种查询方式：?promptId=xxx 精确读取；?filename=xxx 按输出文件名在最近产出里反查（供"上传资产复用参数"用）
export default defineEventHandler(async (event) => {
  const base = comfyBase()
  const q = getQuery(event)
  const promptId = String(q.promptId || '')
  const filename = String(q.filename || '').trim()

  // 按文件名反查：扫描最近 history，找到 outputs 中包含该文件名的条目（同命取最新一条）
  if (filename) {
    try {
      const h: any = await $fetch(`${base}/history`, { params: { max_items: 200 }, timeout: 15000 })
      let hit: { promptId: string; graph: any } | null = null
      for (const [pid, entry] of Object.entries<any>(h || {})) {
        const outs = normalizeOutputs(entry)
        const base1 = filename.replace(/\.[^.]+$/, '')
        const matched = outs.some((o: any) => o.filename === filename || o.filename.replace(/\.[^.]+$/, '') === base1)
        if (!matched) continue
        const graph = entry?.prompt?.[2]
        if (graph && typeof graph === 'object') hit = { promptId: pid, graph } // ComfyUI history 旧→新排列，后者覆盖 = 取最新
      }
      if (hit) return hit
      throw createError({ statusCode: 404, message: `最近产出中没有找到文件「${filename}」对应的资产（请使用下载时的原始文件名）` })
    } catch (e: any) {
      if (e?.statusCode) throw e
      throw createError({ statusCode: 502, message: `无法读取 ComfyUI history: ${e?.message || e}` })
    }
  }

  if (!promptId) throw createError({ statusCode: 400, message: '缺少 promptId 或 filename' })
  try {
    const h: any = await $fetch(`${base}/history/${promptId}`, { timeout: 10000 })
    const entry = h?.[promptId]
    // entry.prompt = [number, workflowId, 提交时的 API 格式图]
    const graph = entry?.prompt?.[2]
    if (!graph || typeof graph !== 'object') {
      throw createError({ statusCode: 404, message: '该资产没有可读取的提交参数' })
    }
    return { graph, promptId }
  } catch (e: any) {
    if (e?.statusCode) throw e
    throw createError({ statusCode: 502, message: `无法读取 ComfyUI history: ${e?.message || e}` })
  }
})

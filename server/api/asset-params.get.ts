// 读取某个资产提交时的完整工作流图（ComfyUI history 里存有提交的 API 图），用于一键复用全部参数
// 两种查询方式：?promptId=xxx 精确读取；?filename=xxx 用 Comfy /history API 宽松反查（供"从资产复用"用）
export default defineEventHandler(async (event) => {
  const base = comfyBase()
  const q = getQuery(event)
  const promptId = String(q.promptId || '')
  const filename = String(q.filename || '').trim()
  // 归一化：去扩展名、去浏览器重复下载的「 (1)」后缀、忽略大小写
  const norm = (s: string) => s.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)$/, '').trim().toLowerCase()

  // 按文件名反查：调 Comfy /history API 扫描最近产出，归一化匹配输出文件名（同命取最新一条）
  if (filename) {
    try {
      const h: any = await $fetch(`${base}/history`, { params: { max_items: 500 }, timeout: 20000 })
      const want = norm(filename)
      let hit: { promptId: string; graph: any; matched: string } | null = null
      for (const [pid, entry] of Object.entries<any>(h || {})) {
        const outs = normalizeOutputs(entry)
        const m = outs.find((o: any) => typeof o.filename === 'string' && norm(o.filename) === want)
        if (!m) continue
        const graph = entry?.prompt?.[2]
        if (graph && typeof graph === 'object') hit = { promptId: pid, graph, matched: m.filename } // ComfyUI history 旧→新排列，后者覆盖 = 取最新
      }
      if (hit) return hit
      throw createError({ statusCode: 404, message: `ComfyUI 最近 500 条产出里没有找到「${filename}」对应的资产（可先在应用里给资产重命名后再试）` })
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

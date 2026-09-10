// 补全 ComfyUI 全量可用 API 的信息端点：
//   GET /api/comfy/info            → 聚合：object_info（节点全量）+ models + embeddings + extensions
//   GET /api/comfy/info?what=nodes → 仅节点定义
//   GET /api/comfy/info?what=models|embeddings|extensions
// 这些是 ComfyUI 原生 /object_info、/models、/models/{folder}、/embeddings、/extensions 的代理与聚合
export default defineEventHandler(async (event) => {
  const base = comfyBase()
  const q = getQuery(event)
  const what = String(q.what || 'all')
  const folder = String(q.folder || '')

  // 模型清单：/models 列出文件夹名，再逐类取文件（并发）
  async function loadModels() {
    const folders: string[] = await $fetch<any>(`${base}/models`, { timeout: 15000 }).catch(() => [])
    const out: Record<string, string[]> = {}
    await Promise.all((folders || []).map(async (f) => {
      try {
        out[f] = await $fetch<any>(`${base}/models/${encodeURIComponent(f)}`, { timeout: 15000 })
      } catch { out[f] = [] }
    }))
    return { folders: folders || [], files: out }
  }

  try {
    if (what === 'nodes') return { ok: true, objectInfo: await $fetch(`${base}/object_info`, { timeout: 25000 }) }
    if (what === 'models') {
      if (folder) return { ok: true, folder, files: await $fetch(`${base}/models/${encodeURIComponent(folder)}`, { timeout: 15000 }) }
      return { ok: true, ...(await loadModels()) }
    }
    if (what === 'embeddings') return { ok: true, embeddings: await $fetch(`${base}/embeddings`, { timeout: 15000 }).catch(() => []) }
    if (what === 'extensions') return { ok: true, extensions: await $fetch(`${base}/extensions`, { timeout: 15000 }).catch(() => []) }

    // all：并发聚合
    const [objectInfo, models, embeddings, extensions] = await Promise.all([
      $fetch(`${base}/object_info`, { timeout: 25000 }).catch(() => null),
      loadModels().catch(() => ({ folders: [], files: {} })),
      $fetch(`${base}/embeddings`, { timeout: 15000 }).catch(() => []),
      $fetch(`${base}/extensions`, { timeout: 15000 }).catch(() => [])
    ])
    return {
      ok: true,
      base,
      nodeCount: objectInfo ? Object.keys(objectInfo as any).length : 0,
      models,
      embeddings,
      extensions: extensions || []
    }
  } catch (e: any) {
    return { ok: false, base, error: e?.message || String(e) }
  }
})

// 媒体代理：把 ComfyUI /view 的图片/视频流式转发给浏览器
export default defineEventHandler(async (event) => {
  const base = comfyBase()
  const q = getQuery(event)
  // 支持 cache=0：清空/刷新后规避浏览器旧图缓存
  const noCache = String(q.cache || '') === '0'
  const params: Record<string, any> = { ...q }
  delete params.cache
  try {
    const res = await $fetch.raw(`${base}/view`, {
      params,
      responseType: 'arrayBuffer',
      timeout: 30000
    })
    setResponseHeaders(event, {
      'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600'
    })
    // 必须转 Buffer：h3 会把 ArrayBuffer 序列化成 {}
    return Buffer.from(res._data as ArrayBuffer)
  } catch (e: any) {
    throw createError({ statusCode: 502, message: `无法从 ComfyUI 获取文件: ${e?.message || e}` })
  }
})

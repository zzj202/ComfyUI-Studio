// 图片上传：把浏览器发来的 multipart 原样转发给 ComfyUI /upload/image
export default defineEventHandler(async (event) => {
  const base = comfyBase()
  const contentType = getHeader(event, 'content-type')
  if (!contentType?.includes('multipart/form-data')) {
    throw createError({ statusCode: 400, message: '需要 multipart/form-data 请求' })
  }
  const raw = await readRawBody(event, false)
  if (!raw || !raw.length) {
    throw createError({ statusCode: 400, message: '没有收到文件数据' })
  }
  try {
    const res: any = await $fetch(`${base}/upload/image`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: raw,
      timeout: 60000
    })
    // ComfyUI 返回 { name, subfolder, type }
    invalidateObjectInfo() // 新图已进服务器列表，缓存里的旧列表不再可信
    return { name: res?.name, subfolder: res?.subfolder || '', type: res?.type || 'input' }
  } catch (e: any) {
    throw createError({ statusCode: 502, message: `上传到 ComfyUI 失败: ${e?.message || e}` })
  }
})

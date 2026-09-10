// 常用参考图库：按文件名读取图片（前端缩略图 / 拖拽入库时取原图）
import { join } from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'
}

export default defineEventHandler((event) => {
  const raw = getRouterParam(event, 'name') || ''
  const name = decodeURIComponent(raw)
  // 防路径穿越：清洗后必须与原名一致且不含分隔符
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw createError({ statusCode: 400, message: '非法文件名' })
  }
  const path = join(refsDir(), name)
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw createError({ statusCode: 404, message: `文件不存在: ${name}` })
  }
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'))
  setHeader(event, 'content-type', MIME[ext] || 'application/octet-stream')
  setHeader(event, 'cache-control', 'no-cache') // 库内容可增删，不 强缓存
  return readFileSync(path)
})

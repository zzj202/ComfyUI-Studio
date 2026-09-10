// 常用参考图库：按文件名删除
import { join } from 'node:path'
import { existsSync, statSync, unlinkSync } from 'node:fs'

export default defineEventHandler((event) => {
  const raw = getRouterParam(event, 'name') || ''
  const name = decodeURIComponent(raw)
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw createError({ statusCode: 400, message: '非法文件名' })
  }
  const path = join(refsDir(), name)
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw createError({ statusCode: 404, message: `文件不存在: ${name}` })
  }
  unlinkSync(path)
  return { ok: true, message: `已从常用参考图移除 ${name}` }
})

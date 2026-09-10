// 常用参考图库公共工具：目录定位（data/refs，gitignored，本机持久）
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

export const refsDir = () => join(process.cwd(), 'data', 'refs')

export function ensureRefsDir() {
  const dir = refsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

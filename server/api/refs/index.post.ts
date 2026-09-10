// 常用参考图库：上传图片到 data/refs/（支持多选）
// 重名自动加序号后缀，不覆盖已有图
import { join } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'

const MAX_SIZE = 20 * 1024 * 1024
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

/** 清洗文件名：只留文件名部分，去掉路径与非法字符 */
function sanitizeName(raw: string): string {
  const base = String(raw || '').split(/[\\/]/).pop() || ''
  const cleaned = base.replace(/[<>:"|?*\x00-\x1f]/g, '').trim()
  return cleaned || ''
}

/** 重名自动加 " (n)" 后缀 */
function uniqueName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 1; i < 1000; i++) {
    const cand = `${stem} (${i})${ext}`
    if (!existsSync(join(dir, cand))) return cand
  }
  return `${stem}-${Date.now()}${ext}`
}

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  if (!parts?.length) throw createError({ statusCode: 400, message: '没有收到文件数据' })
  const dir = ensureRefsDir()
  const saved: string[] = []
  const errors: string[] = []
  for (const p of parts) {
    const rawName = p.filename || ''
    const ext = rawName.toLowerCase().slice(rawName.lastIndexOf('.'))
    if (!IMG_EXT.has(ext)) { errors.push(`${rawName || '未命名'}：仅支持 png/jpg/webp/gif`); continue }
    if (!p.data?.length || p.data.length > MAX_SIZE) { errors.push(`${rawName}：文件为空或超过 20MB`); continue }
    let name = sanitizeName(rawName)
    if (!name) name = `ref-${Date.now()}${ext}`
    if (!name.toLowerCase().endsWith(ext)) name += ext
    name = uniqueName(dir, name)
    writeFileSync(join(dir, name), p.data)
    saved.push(name)
  }
  if (!saved.length) throw createError({ statusCode: 400, message: errors.join('；') || '没有可保存的图片' })
  return { ok: true, saved, errors }
})

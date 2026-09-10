// 常用参考图库：列出 data/refs/ 下的图片（供前端缩略图条展示）
import { join } from 'node:path'
import { readdirSync, statSync } from 'node:fs'

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

export default defineEventHandler(() => {
  const dir = ensureRefsDir()
  const refs = readdirSync(dir)
    .filter((f) => IMG_EXT.has(f.toLowerCase().slice(f.lastIndexOf('.'))))
    .map((f) => {
      const st = statSync(join(dir, f))
      return { name: f, size: st.size, mtime: st.mtimeMs, url: `/api/refs/${encodeURIComponent(f)}` }
    })
    .sort((a, b) => b.mtime - a.mtime) // 新加入的排前面
  return { ok: true, refs }
})

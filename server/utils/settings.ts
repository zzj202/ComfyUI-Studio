import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// 运行时可修改的设置，持久化到 data/settings.json（优先级高于 .env）
const dataDir = () => join(process.cwd(), 'data')
const settingsFile = () => join(dataDir(), 'settings.json')

export function readSettings(): Record<string, any> {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf-8'))
  } catch {
    return {}
  }
}

export function writeSettings(patch: Record<string, any>) {
  mkdirSync(dataDir(), { recursive: true })
  const merged = { ...readSettings(), ...patch }
  writeFileSync(settingsFile(), JSON.stringify(merged, null, 2))
  return merged
}

/** ComfyUI 地址：data/settings.json > .env > 默认值 */
export function resolveComfyBase(): { base: string; source: 'settings' | 'env' } {
  const saved = readSettings().comfyBaseUrl
  if (saved) return { base: String(saved).replace(/\/+$/, ''), source: 'settings' }
  return {
    base: String(useRuntimeConfig().comfyBaseUrl || 'http://127.0.0.1:8188').replace(/\/+$/, ''),
    source: 'env'
  }
}

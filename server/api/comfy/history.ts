// 历史记录管理与绘图：对齐 ComfyUI 原生 /history 的删除能力 + free / interrupt
//   DELETE /api/comfy/history?promptId=xxx  → 删除单条历史
//   POST   /api/comfy/history               → 清空全部历史（body: { all: true }）
//   POST   /api/comfy/free                  → 释放模型/显存（body: { unload_models, free_memory }）
import { comfyBase } from '../../utils/comfy'

export default defineEventHandler(async (event) => {
  const base = comfyBase()
  const method = getMethod(event)

  if (method === 'DELETE') {
    const q = getQuery(event)
    const promptId = String(q.promptId || '')
    if (!promptId) throw createError({ statusCode: 400, message: '缺少 promptId' })
    try {
      await $fetch(`${base}/history`, { method: 'POST', body: { delete: [promptId] }, timeout: 10000 })
      return { ok: true, message: '已从 ComfyUI 服务器删除该历史记录' }
    } catch (e: any) {
      throw createError({ statusCode: 502, message: `删除历史失败: ${e?.message || e}` })
    }
  }

  if (method === 'POST') {
    const body: any = await readBody(event).catch(() => ({}))
    if (body?.free) {
      try {
        await $fetch(`${base}/free`, {
          method: 'POST',
          body: { unload_models: body.unload_models !== false, free_memory: body.free_memory !== false },
          timeout: 15000
        })
        return { ok: true, message: '已请求 ComfyUI 释放模型与显存' }
      } catch (e: any) {
        throw createError({ statusCode: 502, message: `释放失败: ${e?.message || e}` })
      }
    }
    try {
      await $fetch(`${base}/history`, { method: 'POST', body: { clear: true }, timeout: 10000 })
      return { ok: true, message: '已清空 ComfyUI 服务器上的全部历史记录' }
    } catch (e: any) {
      throw createError({ statusCode: 502, message: `清空历史失败: ${e?.message || e}` })
    }
  }

  throw createError({ statusCode: 405, message: '不支持的方法' })
})

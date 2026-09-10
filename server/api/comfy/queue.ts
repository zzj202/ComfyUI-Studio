// 队列完整的读写接口（对齐 ComfyUI 原生 /queue）：
//   GET    /api/comfy/queue → 运行中 + 排队中的完整任务
//   POST   /api/comfy/queue → 清除队列（body: { pending?: boolean, running?: boolean }）
//   DELETE /api/comfy/queue → 删除指定任务（body: { promptId })
import { comfyBase } from '../../utils/comfy'

export default defineEventHandler(async (event) => {
  const base = comfyBase()
  const method = getMethod(event)

  if (method === 'GET') {
    try {
      const q: any = await $fetch(`${base}/queue`, { timeout: 10000 })
      const map = (arr: any[]) => (arr || []).map((it: any) => {
        const graph = it?.[2] || {}
        // 找出该任务涉及的节点标题，便于展示「在跑什么」
        const titles = Object.values<any>(graph).map((n: any) => n?._meta?.title || n?.class_type).filter(Boolean)
        return {
          promptId: it?.[1],
          number: it?.[0],
          clientId: it?.[3]?.client_id || '',
          nodeCount: Object.keys(graph).length,
          summary: titles.slice(0, 4).join(' · ')
        }
      })
      return { ok: true, running: map(q?.queue_running), pending: map(q?.queue_pending) }
    } catch (e: any) {
      return { ok: false, base, error: e?.message || String(e) }
    }
  }

  if (method === 'POST') {
    const body: any = await readBody(event).catch(() => ({}))
    const clearPending = body?.pending !== false
    const clearRunning = body?.running === true
    try {
      const qs = new URLSearchParams()
      if (clearPending) qs.set('clear', 'true')
      if (clearRunning) qs.set('running', 'true')
      if (clearRunning) qs.set('clear', 'true')
      await $fetch(`${base}/queue?${qs.toString()}`, { method: 'POST', timeout: 10000 })
      return { ok: true, message: clearRunning ? '已清空队列（含正在运行的任务会被中止）' : '已清空排队中的任务' }
    } catch (e: any) {
      throw createError({ statusCode: 502, message: `清空队列失败: ${e?.message || e}` })
    }
  }

  if (method === 'DELETE') {
    const body: any = await readBody(event).catch(() => ({}))
    const promptId = String(body?.promptId || '')
    if (!promptId) throw createError({ statusCode: 400, message: '缺少 promptId' })
    try {
      await $fetch(`${base}/queue`, { method: 'POST', body: { delete: [promptId] }, timeout: 10000 })
      return { ok: true, message: '已从队列移除该任务' }
    } catch (e: any) {
      throw createError({ statusCode: 502, message: `移除任务失败: ${e?.message || e}` })
    }
  }

  throw createError({ statusCode: 405, message: '不支持的方法' })
})

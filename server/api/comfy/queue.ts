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
      // ComfyUI 的 /queue POST 只认 JSON body（{clear:true} 清排队；查询参数形式会 500）
      if (clearRunning) {
        // 运行中的任务要靠 /interrupt 中止（clear 只清排队）
        await $fetch(`${base}/interrupt`, { method: 'POST', timeout: 10000 }).catch(() => {})
      }
      if (clearPending) {
        await $fetch(`${base}/queue`, { method: 'POST', body: { clear: true }, timeout: 10000 })
      }
      return { ok: true, message: clearRunning ? '已中止运行中任务并清空排队' : '已清空排队中的任务' }
    } catch (e: any) {
      throw createError({ statusCode: 502, message: `清空队列失败: ${e?.message || e}` })
    }
  }

  if (method === 'DELETE') {
    const body: any = await readBody(event).catch(() => ({}))
    const promptId = String(body?.promptId || '')
    if (!promptId) throw createError({ statusCode: 400, message: '缺少 promptId' })
    try {
      // 关键：ComfyUI 的 {delete:[id]} 只对排队中任务有效，运行中任务会被静默忽略。
      // 运行中的必须走 /interrupt 中止，先查一次队列区分两者。
      const q: any = await $fetch(`${base}/queue`, { timeout: 10000 }).catch(() => null)
      const isRunning = Array.isArray(q?.queue_running) && q.queue_running.some((it: any) => it?.[1] === promptId)
      if (isRunning) {
        await $fetch(`${base}/interrupt`, { method: 'POST', timeout: 10000 })
        return { ok: true, message: '已中止运行中的任务' }
      }
      await $fetch(`${base}/queue`, { method: 'POST', body: { delete: [promptId] }, timeout: 10000 })
      return { ok: true, message: '已从队列移除该任务' }
    } catch (e: any) {
      throw createError({ statusCode: 502, message: `移除任务失败: ${e?.message || e}` })
    }
  }

  throw createError({ statusCode: 405, message: '不支持的方法' })
})

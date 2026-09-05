import WebSocket from 'ws'

// 进度 SSE 通道：服务端连 ComfyUI 的 /ws，把进度消息按 prompt_id 过滤后推给浏览器
// 若 ws 不可用，自动降级为轮询 /history
export default defineEventHandler(async (event) => {
  const promptId = getRouterParam(event, 'id') || ''
  const clientId = String(getQuery(event).clientId || '')
  const base = comfyBase()
  const wsUrl = base.replace(/^http/, 'ws') + `/ws?clientId=${encodeURIComponent(clientId)}`

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      let ws: WebSocket | null = null
      let pollTimer: ReturnType<typeof setInterval> | null = null
      let pollCount = 0

      const send = (data: any) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          /* client gone */
        }
      }

      const cleanup = () => {
        closed = true
        if (pollTimer) clearInterval(pollTimer)
        try { ws?.close() } catch { /* noop */ }
        try { controller.close() } catch { /* noop */ }
      }

      const finish = (data: any) => {
        if (closed) return
        send(data)
        cleanup()
      }

      // 从 history 确认任务结束并取最终状态
      const checkHistory = async () => {
        if (closed) return true
        pollCount++
        try {
          const h: any = await $fetch(`${base}/history/${promptId}`, { timeout: 5000 })
          const entry = h?.[promptId]
          if (entry) {
            const statusStr = entry?.status?.status_str || 'success'
            finish({
              status: statusStr === 'error' ? 'error' : 'done',
              message: statusStr === 'error' ? '执行出错，详见 ComfyUI 日志' : ''
            })
            return true
          }
        } catch { /* ComfyUI 暂时不可达，继续等 */ }
        // 长时间轮询兜底超时（30 分钟）
        if (pollCount > 900) finish({ status: 'timeout', message: '等待超时' })
        return false
      }

      // 兜底轮询：ws 没建立或没收到消息时也能拿到完成状态
      const startPolling = () => {
        if (pollTimer || closed) return
        pollTimer = setInterval(() => { checkHistory() }, 2500)
      }

      // 初始状态
      send({ status: 'queued' })

      // 尝试 ws 转发实时进度
      try {
        ws = new WebSocket(wsUrl)
        ws.on('open', () => send({ status: 'connected' }))
        ws.on('message', (buf: Buffer) => {
          if (closed) return
          let msg: any
          try { msg = JSON.parse(buf.toString()) } catch { return }
          const data = msg?.data || {}
          if (data.prompt_id && data.prompt_id !== promptId) return
          switch (msg.type) {
            case 'execution_start':
              send({ status: 'running', pct: 0 })
              break
            case 'progress':
              send({
                status: 'running',
                pct: data.max ? Math.round((data.value / data.max) * 100) : null,
                node: data.node
              })
              break
            case 'execution_error':
              finish({ status: 'error', message: data?.exception_message || '执行出错' })
              break
            case 'execution_success':
              checkHistory()
              break
            case 'executing':
              if (data.node === null) checkHistory() // 单任务结束信号
              break
          }
        })
        ws.on('error', startPolling)
        ws.on('close', startPolling)
      } catch {
        startPolling()
      }
      // 无论 ws 是否成功，都开一个低频轮询兜底（ws 收不到消息的场景）
      startPolling()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  })
})

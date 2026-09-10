// 本会话批次列表：服务端为唯一数据源（内存 + 磁盘持久化），前端刷新/换浏览器都不丢
import { listBatches } from '../../utils/batch'
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 40))
  const batches = listBatches(limit)
  return {
    batches,
    running: batches.filter((b) => !b.finishedAt && !b.cancelled).length
  }
})

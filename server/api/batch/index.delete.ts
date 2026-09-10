// 清空已结束的批次（?keep=1 可保留最近 1 条）；未完成的批次不受影响
import { clearBatches } from '../../utils/batch'
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const keep = Math.max(0, Number(q.keep) || 0)
  const removed = clearBatches(keep)
  return { ok: true, removed }
})

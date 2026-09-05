// 批量任务状态（轮询共用）
import { getBatchInfo } from '../../utils/batch'
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const info = getBatchInfo(id || '')
  if (!info) {
    // 任务不存在（已被清空/从未创建）：返回 exists:false，前端据此停止轮询
    return { exists: false, id }
  }
  return { exists: true, ...info }
})

// 停止 / 清空批量任务
import { stopBatch, disposeBatch, batchExists, getBatchInfo } from '../../utils/batch'
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const fullStop = String(getQuery(event).clear || '') === '1'
  if (!batchExists(id || '')) {
    return { ok: false, exists: false, message: '任务不存在或已结束' }
  }
  if (fullStop) {
    // 彻底清除（内存 + runloop 取消）
    stopBatch(id!)
    disposeBatch(id!)
    return { ok: true, cleared: true }
  }
  // 停止：取消 runloop，保留状态用于回看
  stopBatch(id!)
  const info = getBatchInfo(id!)
  return { ok: true, stopped: true, state: info }
})

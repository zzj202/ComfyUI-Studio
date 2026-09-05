// 批次列表（排障/诊断用）：返回内存中全部批次摘要
import { allBatchSummaries } from '../../utils/batch'
export default defineEventHandler(() => ({ batches: allBatchSummaries() }))

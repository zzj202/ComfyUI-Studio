// 工作流详情（原始 API 格式 JSON）
export default defineEventHandler((event) => {
  const name = getRouterParam(event, 'name') || ''
  const res = readWorkflowFile(decodeURIComponent(name))
  if (!res.ok) throw createError({ statusCode: 404, message: res.error })
  return res.graph
})

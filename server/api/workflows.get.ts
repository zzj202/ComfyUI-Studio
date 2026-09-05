// 工作流列表
export default defineEventHandler(() => {
  return { workflows: listWorkflows(), dir: 'server/workflows' }
})

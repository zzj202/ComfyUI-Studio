// 服务器端节点能力查询：/object_info/{nodeClass}
// 前端未知节点时可查其输入/输出定义（含枚举可选值），避免手输错参数
export default defineEventHandler(async (event) => {
  const base = comfyBase()
  const q = getQuery(event)
  const node = String(q.node || '')
  try {
    if (!node) {
      const all: any = await $fetch(`${base}/object_info`, { timeout: 25000 })
      return { ok: true, nodes: Object.keys(all).sort() }
    }
    const info: any = await $fetch(`${base}/object_info/${encodeURIComponent(node)}`, { timeout: 15000 })
    return { ok: true, node, info }
  } catch (e: any) {
    throw createError({ statusCode: 502, message: `读取节点信息失败: ${e?.message || e}` })
  }
})

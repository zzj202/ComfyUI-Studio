// ComfyUI 服务器上可用的 LoRA 文件列表（供前端把 lora_name 字段渲染成下拉框）
export default defineEventHandler(async () => {
  const base = comfyBase()
  try {
    const res: any = await $fetch(`${base}/object_info/LoraLoaderModelOnly`, { timeout: 8000 })
    const list: string[] = res?.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || []
    return { loras: list }
  } catch (e: any) {
    return { loras: [], error: e?.message || '获取 LoRA 列表失败' }
  }
})

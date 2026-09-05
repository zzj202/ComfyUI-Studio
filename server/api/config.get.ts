// 读取当前 ComfyUI 地址配置
export default defineEventHandler(() => {
  const { base, source } = resolveComfyBase()
  return { comfyBaseUrl: base, source }
})

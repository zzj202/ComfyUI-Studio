export default defineNuxtConfig({
  compatibilityDate: '2026-09-05',
  devtools: { enabled: false },
  ssr: false,
  // 关闭 app manifest，规避 dev 下 "#app-manifest" 预转换报错
  experimental: { appManifest: false },
  // 3000 常被其他项目占用，固定使用 3100
  devServer: { host: '0.0.0.0', port: 3100 },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    // 可通过 .env 的 COMFY_BASE_URL 覆盖
    comfyBaseUrl: 'http://127.0.0.1:8188'
  }
})

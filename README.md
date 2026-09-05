# ComfyUI Studio

基于 **Nuxt 3 全栈一体** 的 ComfyUI 友好操作界面：不用再打开 ComfyUI 原生网页拖节点，选工作流 → 填参数 → 一键提交，实时进度条 + 结果预览下载。

## 快速开始

```bash
npm run dev
# 浏览器打开 http://localhost:3100（同一局域网手机/其他电脑可访问 Network 地址）
```

**配置 ComfyUI 地址（推荐方式）**：点右上角 **⚙ 连接设置**，填入地址后点「测试并保存」——测试通过才落盘、立即生效、无需重启，保存到 `data/settings.json`（优先于 `.env`）。也可以继续用 `.env` 的 `COMFY_BASE_URL`。

## 接入自己的工作流

1. 打开 ComfyUI 原生网页，右上角设置（齿轮）→ 勾选 **开发者模式 (Dev mode)**
2. 加载你的工作流后，点 **导出 (API)**（注意不是"导出"，要带 API 字样的），得到 `xxx.json`
3. 把 json 放进 `server/workflows/` 目录（文件名就是界面里显示的工作流名）
4. 刷新 Studio 页面即可看到

界面的参数表单是**根据工作流 JSON 自动生成**的：所有未被连线占用的输入（提示词、seed、步数、宽高、采样器等）都会变成可编辑字段，提示词类字段置顶、seed 带随机按钮，节点分组可折叠。

## 架构

```
浏览器 (pages/index.vue)
   │  fetch / EventSource(SSE)
   ▼
Nuxt server/api（后端代理，无需单独部署）
   ├─ /api/health          探测 ComfyUI（/system_stats）
   ├─ /api/workflows       列出 server/workflows/*.json
   ├─ /api/prompt          POST /prompt 提交队列（应用参数覆盖）
   ├─ /api/progress/:id    SSE 实时进度（服务端连 ComfyUI /ws 转发，失败自动降级轮询）
   ├─ /api/history         最近产出 / 单任务结果
   └─ /api/view            图片/视频文件流式代理
   ▼
ComfyUI (HTTP API + WebSocket)
```

## 生产部署

```bash
npm run build && node .output/server/index.mjs
# ComfyUI 地址用环境变量传入：
# COMFY_BASE_URL=https://comfy.example.com node .output/server/index.mjs
```

## 常见问题

- **右上角显示"ComfyUI 未连接"**：检查 `.env` 的 `COMFY_BASE_URL`，点击状态胶囊可重试；改完 `.env` 需重启 dev server。
- **提交报"提交被 ComfyUI 拒绝"**：通常是模型/LoRA 文件名对不上（检查点名称必须与 ComfyUI `models` 目录里的文件名完全一致），错误详情里有具体是哪个节点的问题。
- **提示词没有生效**：确认导出的是 API 格式 JSON（含 `"class_type"` 数字键结构），而不是 UI 格式（含 `"nodes"`/`"links"` 数组）。

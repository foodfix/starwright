# M6 验收文档 — 发布打磨

> 依据 DEVELOPMENT.md §11 总表展开。开工前填写交付物与验收标准；完成时逐项填写验证记录。

## 1. 交付物

| # | 交付物 | 说明 |
|---|---|---|
| 1 | i18n zh/en | react-i18next；`apps/web/src/i18n/` zh/en 文案包；UI 文案全量覆盖两语言；设置页 UI 语言切换；游戏数据保留英文原文 |
| 2 | AI 翻译按钮 | 结算卡片/详情等游戏数据全文处提供「AI 翻译」按钮（调用当前 LLM 翻译，localStorage 缓存）；未配置 AI 时禁用 |
| 3 | 导出/导入 | 设置页数据管理：导出/导入 JSON 存档文件（campaign + chat，含 version 迁移链 `migrateCampaignState`）；导入校验失败给出可读错误 |
| 4 | README / LICENSE | MIT LICENSE；README（双语）含快速开始、部署说明、固定 CC-BY 4.0 attribution 块 |
| 5 | token 计量 | 顶栏累计 prompt/completion tokens 展示（M3 已有，M6 复核 + 双语化） |
| 6 | 失败模式提示 | LLM 诊断码 → 可读提示（双语）：鉴权失败 / 404 / 限流 / 网络与 CORS / 不支持 function calling；聊天错误与连接测试共用同一映射 |
| 7 | 关于/署名页 | 设置页「关于」节：CC-BY 4.0 署名（Ironsworn: Starforged © Shawn Tomkin，数据来自 Datasworn）+ MIT 代码许可说明 |
| 8 | 静态构建 | `pnpm build` 产出可部署 `dist/`（含 `starforged.json` 静态资源）；README 记录 GitHub Pages / Netlify / Cloudflare Pages 部署要点 |

## 2. 验收标准与验证命令

| # | 标准 | 验证方式 |
|---|---|---|
| A1 | `pnpm lint && pnpm typecheck && pnpm test` 全绿（含 web 新增单测） | 命令输出 |
| A2 | `pnpm build` 成功，`dist/` 含 `index.html`、hash 分包与 `data/starforged.json`；`pnpm preview` 可加载 | 命令 + 手工 |
| A3 | UI 语言切换 zh/en：全部界面文案（顶栏/角色面板/向导/叙事/结算卡/工具日志/设置）切换生效，无遗漏硬编码 | 手工抽查 |
| A4 | 导出 → 删除存档 → 导入回环：战役状态与聊天流恢复一致；旧版本（v1）campaign 字段经迁移链导入成功 | 手工 + 单测回环 |
| A5 | 导入非本项目 JSON / 损坏 JSON：拒绝并显示可读错误，现有存档不受影响 | 手工 |
| A6 | AI 翻译按钮：配置 AI 后可翻译 move/oracle 全文，刷新后命中缓存（不再请求）；未配置时按钮禁用 | 手工 |
| A7 | 断网/错误 Key/错误 model 各触发一次，错误提示为可读双语提示而非原始异常 | 手工 |
| A8 | README/LICENSE 存在且含固定 attribution 块；设置页「关于」节同款文案 | 手工 |

## 3. 验证记录（完成时填写）

- [x] A1 命令输出摘要（2026-09-15）：`pnpm lint`（0 问题）；`pnpm typecheck`（tsc -b 0 错误）；`pnpm test` — web 18 / engine 98 / ai 81 / data 30，共 227 通过、0 失败。新增单测：`saveFile.test.ts`（导出导入回环、v1 迁移、非法输入拒绝、文件名格式）、`translate.test.ts`（completeOnce 无工具非流式请求、HTTP 诊断、translateText 提示词/空输入直通/空响应拒绝）。
- [x] A2 构建与预览：`pnpm build` 成功；`dist/` = `index.html` + `assets/index-*.css/js` + `data/starforged.json`（1.4 MB）。修复了构建期静态资源错位（vite-plugin-static-copy v4 将 `../../data/starforged.json` 的 `data` 段拼接在 dest 后，曾产出 `dist/data/data/`，改为 `dest: ''`）。`vite preview` 冒烟：`/` 200、`/data/starforged.json` 200、bundle 含双语资源。
- [x] A3 双语抽查（代码级）：全部 UI 组件（App/向导/角色面板/叙事/结算卡/工具日志/设置）文案经 `t()` 输出；`i18n/zh.ts` 以 `UiBundle` 类型与 en 键结构逐一对应（缺键即编译失败）；zh 唯一保留的英文为语言名称选项（惯例不译）。浏览器内人工切换抽查待试玩复核。
- [x] A4 导出导入回环：`saveFile.test.ts` 覆盖 build → JSON 序列化 → parse 深比对一致；v1 campaign（缺 experience/controls）经 `migrateCampaignState` 迁移导入成功；无 chat 快照与缺省 toolLog/usage 的快照均可归一化。浏览器内端到端回环待试玩复核。
- [x] A5 非法导入拒绝（单测级）：任意 JSON/数组/null → `notSaveFile`；损坏 campaign → `badCampaign`；不可迁移版本（99）→ `cannotMigrate`；chat 结构非法 → `badChat`；错误以 `saveFile.<code>` 双语可读提示呈现，不触碰现有存档。
- [x] A6 AI 翻译缓存：`translateText`（packages/ai）+ localStorage 缓存（键 = 目标语言+文本 djb2 哈希+长度，上限 300 条）；命中缓存直接渲染（不发请求，单测覆盖空输入直通与请求发起路径）；未配置 baseUrl/model 时按钮禁用并提示「请先在设置中配置 AI」。真实 LLM 翻译效果待双通道试玩抽查。
- [x] A7 失败模式提示：`shared/diagnostics.ts` 统一映射 auth_failed / not_found / rate_limited / network_error / no_function_calling / malformed_response / http_error → 双语可读提示；聊天错误与设置页连接测试共用；未知码回退服务商原始消息。网断/错 Key 场景由 ai 包既有单测覆盖（401 → auth_failed 等），真实网络手工触发待试玩。
- [x] A8 署名：`README.md`（英中双语）含固定 attribution 块（Ironsworn: Starforged © Shawn Tomkin；数据来自 Datasworn，CC-BY 4.0；非官方关联声明）与部署说明（GitHub Pages 子路径 base、Ollama CORS）；`LICENSE` MIT；设置页「关于」节同款双语署名。

手工双通道试玩（M3 起适用，本里程碑聚焦打磨，抽查即可）：
- DeepSeek（云）：待试玩（需真实 API Key，由玩家/维护者执行；重点：双语界面切换、AI 翻译按钮、导出导入回环）。
- Ollama（本地）：待试玩（重点：本地端点 CORS 失败时的可读提示）。

日期：2026-09-15（自动化部分）；手工试玩部分待执行。


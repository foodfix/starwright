# M3 验收清单 — AI GM 循环

> 依据 `docs/DEVELOPMENT.md` §11「M3 AI GM 循环」与 §11.1 展开，设计细节见 `docs/ai-design.md`。

## 1. 交付物

| # | 交付物 | 说明 | 状态 |
|---|---|---|---|
| D1 | SSE 流式客户端 | `packages/ai`：`data:` 帧解析、`[DONE]`、tool_calls 按 index 增量聚合、usage 统计（末帧 last-wins）、错误诊断映射（auth_failed/not_found/rate_limited/http_error/network_error/aborted/malformed_response） | ✅ |
| D2 | 连接测试 | 非流式强制 FC 探测（probe 工具 `report_ready`），tool_choice 降级链 named→required→auto；`auto` 无 tool_call 判 `no_function_calling`；延迟与可读诊断 | ✅ |
| D3 | LLM 预设 | DeepSeek/Kimi(Qwen)/OpenAI/OpenRouter/Ollama baseUrl+模型模板，推荐标注 | ✅ |
| D4 | 工具协议 | M3 子集 15 工具（§7.3 已登记），JSON Schema 与 EngineEvent 一一对应；失败回传 `{error:{code,message,hint?}}` 供模型自纠 | ✅ |
| D5 | make_move 最小版 | 按 roll_type 分派：action_roll/progress_roll 骰事件 + Datasworn 结局文本（`{{table:...}}` 递归掷表展开）；no_roll 返回文本；special_track 结构化拒绝（M4） | ✅ |
| D6 | 系统提示词 | GM 行为规范（en/zh 双版本，叙事语言切换）+ 每回合重建状态快照（角色/meters/momentum(max,reset)/impacts/轨道/legacy/场景/最近 journal）+ moves/oracles 目录树（仅 id+名称） | ✅ |
| D7 | agent 循环 | 工具预算（默认 12/回合）→ 去工具强制收尾（预算内违规调用被拒并保持消息配对）；中断保留已执行结果并封口悬挂 tool_calls；usage 累计 | ✅ |
| D8 | 最小聊天 UI | 三栏布局：状态栏（stats/meters/momentum/轨道/impacts/legacy/场景）+ 叙事流（流式渲染）+ 结算卡片（骰值/结局/数值变化）+ GM 工具日志（逐条可展开 args/result）+ 设置面板（预设/连接测试/语言/预算/token 用量） | ✅ |
| D9 | 测试 | SSE 解析 8 项、mock fetch 客户端 14 项、工具执行 17 项、伪模型集成 7 项 + trimHistory 4 项 + 提示词/语言/中断 3 项（ai 合计 51） | ✅ |

## 2. 验收标准与验证命令

| # | 标准 | 验证方式 | 记录 |
|---|---|---|---|
| A1 | `pnpm lint` 通过 | 退出码 0 | ✅ 0 error 0 warning |
| A2 | `pnpm typecheck` 通过 | `tsc -b` 退出码 0（含 packages/ai 项目引用） | ✅ |
| A3 | `pnpm test` 通过 | Vitest：data 15 + engine 71 + ai 51 = 137 全过 | ✅ |
| A4 | INV-1/2：AI 触达状态仅经工具；掷骰仅引擎 | `agent.test.ts`「never lets prose change state」：伪模型仅文本宣称伤害时，health/momentum/journal/seq 零变化；全部数值变化均来自 executeToolCall → `reduce` | ✅ |
| A5 | 伪模型全流程 | `agent.test.ts`：固定种子「swear_vow → make_move(Swear an Iron Vow) → roll_oracle → adjust_meter → end_scene」，断言 6 次请求均含重建 system、轨道/结算/场景/usage、错误自纠（unknown_move→修正）、预算收尾（第 3+ 请求无 tools、违规调用被拒） | ✅ |
| A6 | 连接测试通过（真实验证） | 手工：设置页「Test connection」，DeepSeek 与本地 Ollama 各一次 | ⬜ 待人工（步骤见 §4） |
| A7 | 真实模型含 move 结算对话（真实验证） | 手工：对话触发 make_move，结算卡片与状态栏更新 | ⬜ 待人工（步骤见 §4） |
| A8 | 文档先行 | `docs/ai-design.md` 新增；`DEVELOPMENT.md` §7/§7.3 同步（adjust_meter/adjust_momentum 更名、add_track/swear_vow 登记、M3 子集标注）先于代码 | ✅ |
| A9 | `pnpm build` 通过 | data/engine/ai `tsc -b` + web `vite build`（starforged.json 拷入 `dist/data/`） | ✅ |

## 3. 手工检查项（双通道试玩，M3 起适用）

| # | 检查 | 记录 |
|---|---|---|
| H1 | DeepSeek（云）试玩 30 分钟：连接测试、含 move 结算对话、结算卡片对照 Rules-Summary PDF 抽查 | ⬜ 待人工 |
| H2 | Ollama（本地 qwen 系）试玩 30 分钟：`OLLAMA_ORIGINS` 说明生效、连接测试、对话 | ⬜ 待人工 |
| H3 | Key 安全：Key 仅 localStorage，不入存档/日志/GM 面板 | ✅ 代码核查：`settings.ts` 仅写 `localStorage('starwright.settings.v1')`；campaign/chat/GM 面板数据结构均不含 key |
| H4 | 预算收尾：预算耗尽后停止工具调用并以文本总结 | ✅ 自动覆盖（`enforces the tool budget` 伪模型测试）；人工复验随 H1 |

## 4. 验证记录

- 日期：2026-09-15（自动化部分）
- 环境：Node v24.16.0 / pnpm 12.4.1（CI 为 Node 22）
- `pnpm lint`：0 error 0 warning
- `pnpm typecheck`：tsc -b（data/engine/ai/web 项目引用）0 error
- `pnpm test`：data 15 passed + engine 71 passed + ai 51 passed（合计 137）
- `pnpm build`：三包 tsc -b 通过；web vite build 成功，`dist/data/starforged.json` 已拷贝
- `pnpm format:check`：全部通过
- dev 冒烟：`pnpm dev` 下页面 200、`/data/starforged.json` 200（1,433,427 字节，与源一致）
- 结论：自动化验收全部通过；A6/A7/H1/H2 属真实模型人工试玩，留待验证后勾选。

### 人工验证步骤（A6/A7/H1/H2）

1. `pnpm dev` 打开页面 → ⚙ Configure AI → 选预设、填 Key/模型 → Test connection（DeepSeek：`https://api.deepseek.com/v1` + `deepseek-chat`；Ollama：`http://localhost:11434/v1` + 已拉取的 qwen 模型，HTTPS 站点需 `OLLAMA_ORIGINS='*'`）。
2. 发送如 "I swear to find my missing sister"，预期：模型调用 swear_vow/make_move，出现带骰值的结算卡片，左侧状态栏出现誓言轨。
3. 连续对话推进一个场景（含一次 move 结算与 end_scene），对照 Rules-Summary 抽查 score/结局判定；检查 GM 活动面板审计明细。
4. 工具预算调至 2 后再试一轮，确认预算耗尽后模型不再调用工具、以文本收尾。

### 实现备注

- `ExecutorContext` 以 `getState/replaceState` 闭包接入宿主（web 的 store 或测试的局部状态），ai 包不持有权威状态；全部机制结算走 `engine.reduce`（INV-1/4）。
- make_move 不自动应用 move 文本中的增益/损耗（如 "Take +1 momentum"）——由模型按规范用 `adjust_momentum` 等工具落地，结算卡片与审计链因此完整；trigger 匹配与内嵌 oracle 自动掷留给 M4。
- `roll_oracle` 为引擎函数直接调用（不产生 journal settlement），事件包装按 engine-design §3 说明保持函数形态；GM 面板与结算卡片仍展示完整骰值。
- usage 为 last-wins 语义（OpenAI 风格末帧携带）；个别网关不回 usage 时显示 0。
- 战役状态 M3 不落库（刷新重置，UI 已知限制）；Dexie 存档随 M4 向导落地（§8.4）。

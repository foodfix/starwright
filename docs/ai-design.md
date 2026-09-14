# AI 层专题设计（packages/ai）与 M3 最小 UI

> 依据 `docs/DEVELOPMENT.md` §7/§8 展开，自 M3 起维护。M3 范围：OpenAI 兼容客户端 + streaming + 工具协议、系统提示词与快照、最小聊天 UI + 结算卡片 + 工具日志。M4 范围：make_move 全量接入（trigger 校验、内嵌 oracle、special_track）、新档向导、Dexie 存档。M5 范围：资产自动化工具、legacy/誓言/纽带生命周期工具、make_move 资产联动（asset_control 触发 + enhancements）、提示词资产/经验指引。

## 1. 范围划分

| 能力 | M3 | M4 | M5 | 之后 |
|---|---|---|---|---|
| SSE 流式客户端、tool_calls 增量聚合、usage 统计 | ✅ | — | — | — |
| 连接测试（强制 function calling 探测 + 诊断） | ✅ | — | — | — |
| 工具注册子集（见 §5） | 15 个 | 15 个（make_move 升级） | +11 个（资产 5 + legacy/誓言/纽带 5 + adjust_legacy 登记） | M6 视需要微调 |
| make_move | 最小版：按 `roll_type` 执行骰事件 + 结局文本（含 `{{table:...}}` 展开） | 全量：trigger 校验、highest/lowest 自动选值、custom→add、special_track（legacy 进度投）、no_roll 文本展开、内嵌 oracle 自动掷/`oracle_id` 选择；2 个 asset_control move 结构化拒绝 | asset_control/attached_asset_control 经 `asset_id` 结算（唯一匹配自动选定）；payload 附 `enhancements[]`；资产内嵌 12 move 经目录调用 | — |
| 系统提示词（GM 规范 + 快照 + 目录树） | ✅ | 快照增 assets 行；规范增触发选择/oracle 选择说明 | 规范增资产/经验/誓言生命周期指引；快照增 XP、资产计量器/控制/挂载行 | M6 随 i18n 打磨 |
| agent 循环（工具预算、强制收尾） | ✅ | — | — | — |
| UI：聊天流/结算卡片/工具日志/状态栏/设置 | ✅ | 新档向导（Truths→角色→资产→开场）、资产展示 | 状态栏增 XP 与资产计量器；结算卡片支持新 outcome 种类 | M6 i18n/打磨 |
| 存档 | 不落库（刷新重置） | Dexie 自动保存/加载/删除（§9.2） | 载入经 migrateCampaignState v1→v2 | M6 导出/导入 |

## 2. 包结构与约束（INV-4 同源约束：无 DOM、无 React）

```
packages/ai/src/
├── index.ts        # 导出
├── types.ts        # ChatMessage/ToolCall/ToolSpec/LlmConfig/TurnCallbacks/TurnResult
├── args.ts         # M5：工具参数解析与 GLM/Qwen arg_key/arg_value 归一化
├── presets.ts      # URL 归一化辅助（normalizeBaseUrl/chatCompletionsUrl）；M4 起无内置 provider 预设
├── sse.ts          # 增量 SSE 行解析（feed(str) → 事件数组），纯函数、可单测
├── client.ts       # streamChat（fetch 注入）、testConnection
├── tools.ts        # M3 工具 JSON Schema（与 EngineEvent 一一对应）+ 目录/详情只读工具
├── executor.ts     # createToolExecutor({ index, rng, getState, replaceState }) → executeToolCall
├── prompt.ts       # buildSystemPrompt（GM 规范 + buildSnapshot + 目录树）
└── agent.ts        # runTurn：组装 messages → 流式补全 → 工具执行 → 循环 → 强制收尾
```

- 依赖：`@starwright/data`（类型/索引）、`@starwright/engine`（reduce/rollOracle/createNewCampaign）；0 运行时第三方依赖，`fetch`/`AbortSignal` 用标准全局（Node ≥20 与浏览器同构）。
- `fetchImpl` 可注入：默认 `globalThis.fetch`，测试注入 mock。
- ai 包不持有权威状态：`executor` 以 `getState/replaceState` 闭包接入宿主（web 的 Zustand store / 测试的局部变量），保证「谁拥有存档谁落库」（§9：web 调 engine.reduce）。

## 3. OpenAI 兼容协议

### 3.1 请求

`POST {baseUrl}/chat/completions`，`Authorization: Bearer {key}`（Ollama 无 key 时省略该头）。body：

```json
{
  "model": "...", "messages": [...], "stream": true,
  "tools": [...],                      // 预算耗尽后的收尾请求省略
  "stream_options": { "include_usage": true }
}
```

- `messages` 角色：`system`（1 条，见 §6）/ `user` / `assistant`（`content` 可为 null，可带 `tool_calls`）/ `tool`（`tool_call_id` + 结果 JSON 字符串）。
- 工具结果统一 `JSON.stringify` 为字符串 content；成功为结果对象，失败为 `{ "error": { "code", "message", "hint"? } }`（§7.2 错误自纠）。
- 温度等采样参数 M3 不暴露（GM 需要稳定遵守规则），预设内定 0.7；后续如需再开放。

### 3.2 SSE 解析（sse.ts）

- 按 `\n` 分帧，`data: ` 前缀剥除；`data: [DONE]` 结束；空行/注释行（`:` 开头）忽略。
- JSON chunk：`choices[].delta`，`delta.content`（字符串增量）、`delta.tool_calls[]`（`index` + 可选 `id`/`function.name`/`function.arguments` 片段，**按 index 聚合、arguments 字符串拼接**）；`delta.role` 首帧出现。
- `usage`（prompt_tokens/completion_tokens）出现在任一 chunk 顶层即累计记录（OpenAI 风格为最后一个 chunk）；缺失则记 0。
- 兼容：部分网关在 delta 外给出 `message`（非流式形状）——若出现则整体采纳一次。`finish_reason` 取最后一次非空值。
- 兼容（M5）：GLM/Qwen 系网关可能把 `function.arguments` 序列化为 `<arg_key>k</arg_key><arg_value>v</arg_value>` 标签序列或 `{"arg_key": ..., "arg_value": ...}` 重复键 JSON——executor 在 JSON 解析前先做**参数归一化**（`args.ts`，见 §3.4），还原为标准键值对象后再分派工具。
- 推理内容（`aggregation.reasoning`）：`delta.reasoning_content`（GLM/DeepSeek 系）与 `delta.reasoning`（OpenRouter 等）增量聚合；非流式形状取 `message.reasoning_content ?? message.reasoning`。经 `streamChat` 的 `onReasoningDelta` 实时上抛，仅透传展示——不写入历史、不回传模型；非推理模型为空串。

### 3.3 错误诊断（testConnection 与 streamChat 共用映射）

| 症状 | 诊断码 | 用户提示 |
|---|---|---|
| HTTP 401/403 | `auth_failed` | API Key 无效或无权限 |
| HTTP 404 | `not_found` | baseUrl 或模型名错误（含拼 path 检查 `/chat/completions`） |
| HTTP 429 | `rate_limited` | 限流/配额 |
| HTTP 4xx/5xx 其他 | `http_error` | 展示状态码与截断的响应体 |
| fetch 网络异常 | `network_error` | 无法连接（浏览器下大概率 CORS 或离线；本地 Ollama 需配置 `OLLAMA_ORIGINS`） |
| 中断 | `aborted` | 用户取消 |

## 3.4 工具参数归一化（M5）

`args.ts` 的 `parseToolArguments` 是所有工具入参的唯一入口，按序尝试：

1. **标签格式**（GLM/Qwen 原生 tool-call 形态，可能含 `<tool_call>` 包裹文本）：提取全部 `<arg_key>k</arg_key><arg_value>v</arg_value>` 对；值尝试 JSON.parse（对象/数组/数字/布尔），失败则按字符串保留。
2. **重复键 JSON**：原文含 `"arg_key"` 时按序列扫描 `"arg_key":"…"` / `"arg_value":<balanced value>` 配对（JSON.parse 会丢重复键，必须在字符串层解析）。
3. **标准 JSON**：以上都不命中时按原逻辑 `JSON.parse`；对象 → 透传，失败 → `invalid_json`（附 hint）。

归一化只影响**参数解码**，不改变工具 schema 与引擎事件的对应关系；错误仍以 `{ error: { code, message, hint? } }` 回传模型自纠。

## 4. 连接测试

1. 发**非流式**请求：`tools: [probe_tool]`（一个无参 trivial 工具 `report_ready`），`tool_choice: {"type":"function","function":{"name":"report_ready"}}`，max_tokens 很小。
2. 判定：响应含 `tool_calls[].function.name === 'report_ready'` → 通过（模型支持 FC）。
3. 若 400 且错误文本含 `tool_choice`/`function`（部分网关不支持强制指定）→ 降级重试 `tool_choice: "required"`；再失败降级 `"auto"`；`auto` 下若仍无 tool_calls → `no_function_calling`（建议换模型，见预设标注）。
4. 输出：`{ ok, latencyMs, model, diagnostic? }`。

## 5. 工具协议（M3 注册子集，M4 升级 make_move）

> 全集登记在 `DEVELOPMENT.md` §7.3，本表为实现子集；工具 JSON Schema 与 `EngineEvent` 一一对应（INV-1：工具是 AI 触达状态的唯一通道）。

| 工具 | 参数（JSON Schema 要点） | 执行 |
|---|---|---|
| `make_move` | `move_id`、`stat?`/`meter?`（至多其一）、`add?`、`track_id?`（progress_roll/special_track 必填或可推导）、`oracle_id?`（M4：内嵌 oracle 选择） | 见 §5.1 分派。成功返回 `{ move, outcomeKind?, engineOutcome?, rolls?, text, oracleRolls?, oracleCandidates?, selection? }` |
| `roll_oracle` | `table_id` | `rollOracle(tableId, ctx)`，返回 `{ roll, match, text, suggestion? }` |
| `get_move_detail` | `move_id` | move 全文（trigger 条件、outcomes、oracles 引用），只读 |
| `get_oracle_detail` | `table_id` | 表名/路径 + 全部行区间，只读 |
| `adjust_meter` | `meter` ∈ health/spirit/supply，`delta` 非零整数 | `adjust_meter` 事件（恢复封锁由引擎拒绝） |
| `adjust_momentum` | `delta` 非零整数 | `adjust_momentum` 事件（[-6, max] 夹取） |
| `burn_momentum` | `roll_id` | `burn_momentum` 事件（须引用本役 action_roll 的 rollId） |
| `mark_impact` | `impact_id`、`asset_id?`（车辆类必填） | `mark_impact` 事件 |
| `clear_impact` | `impact_id` | `clear_impact` 事件（永久类拒绝） |
| `add_track` | `title`、`rank`（可 null）、`kind?` | `add_track` 事件 |
| `swear_vow` | `title`、`rank` | `add_track { kind: 'vow' }` 的语义化包装 |
| `mark_progress` | `track_id`、`marks?` | `mark_progress` 事件（legacy 轨拒绝，提示 adjust_legacy） |
| `adjust_legacy`（M5） | `legacy`、`ticks`（可负，纽带减损） | `adjust_legacy` 事件；正向自动结算经验 |
| `update_track`（M5） | `track_id`、`title?`、`rank?`、`ticks?` | `update_track` 事件（move 文本落地：重掷清格/升档） |
| `fulfill_vow`（M5） | `track_id`、`reward?`（full/one_rank_lower，默认 full） | progress_roll @vow 轨 + 命中时 `adjust_legacy(quests_legacy)` 按 rank 奖励 + `remove_track`；miss 只返回骰值与文本 |
| `forsake_vow`（M5） | `track_id` | `remove_track`（clear the vow；代价由模型用 endure_stress 等工具补齐） |
| `forge_bond`（M5） | `track_id`、`confirmed?`（weak hit 完成请求后重调） | progress_roll @connection 轨；strong hit 或 confirmed weak hit → bonds_legacy 按 rank 奖励 + `remove_track` |
| `mark_bond_decrease`（M5） | `ticks`（正数） | `adjust_legacy { ticks: -n }` |
| `add_asset`（M5） | `asset_id`、`pay_with_experience?`、`attach_to?` | `add_asset` 事件 |
| `discard_asset`（M5） | `asset_id` | `discard_asset` 事件 |
| `enable_ability`（M5） | `asset_id`、`ability_index`、`pay_with_experience?`、`requirement_confirmed?` | `enable_ability` 事件 |
| `adjust_asset_meter`（M5） | `asset_id`、`control`、`delta` | `adjust_asset_meter` 事件 |
| `set_asset_control`（M5） | `asset_id`、`control`、`value` | `set_asset_control` 事件（is_impact 控制走 mark_impact/clear_impact） |
| `set_flag` | `key`、`value` | `set_flag` 事件 |
| `add_journal_entry` | `text` | `add_journal_entry` 事件；成功 payload 附 `text` 原文（UI 卡片展示用） |
| `end_scene` | — | `end_scene` 事件 |

- ~~未注册（M5+）~~ → M5 全部登记：`add_asset`/`discard_asset`/`enable_ability`/`adjust_asset_meter`/`set_asset_control`、`forge_bond`/`mark_bond_decrease`、`fulfill_vow`/`forsake_vow`、`adjust_legacy`/`update_track`。工具总数 26。
- **命名同步**：§7.3 原行 `update_meter / set_momentum / burn_momentum` 修订为 `adjust_meter / adjust_momentum / burn_momentum`（与引擎事件同名，减少模型混淆）；`mark_progress` 行补 `add_track / swear_vow`（M3）。
- `mark_impact` 等改变状态的结算全部走 `reduce`；失败不落 journal，错误 JSON 回传模型。
- Advance（3 XP 新资产 / 2 XP 升级）不设独立工具——由 `add_asset`/`enable_ability` 的 `pay_with_experience` 承载（GM 规范注明）；Earn Experience 由 `adjust_legacy` 自动累积，模型无需（也不得）手工记 XP。

### 5.1 make_move 全量分派（M4）

按 `move.roll_type` 与 trigger 结构分派：

1. **trigger 校验**（有 `trigger.conditions` 的 move）：
   - 汇总全部 conditions 的 `roll_options` 为合法集：`stat`（stat id 集）、`condition_meter`（meter 集）、`progress_track`（须 track_id）、`custom`（带 `value` 的 labeled 项，映射为 `add`，如 Develop Your Relationship 的 +rank=1..5）、`*_legacy`（special_track 用）、`asset_control`/`attached_asset_control`（M5 起经 `asset_id` 结算，见 §5.2；M4 曾结构化拒绝）。
   - 模型传入的 stat/meter 不在合法集 → 错误 `invalid_roll_selection`，`valid` 列出合法项（自纠）。
   - `method: highest/lowest` 且未传选择 → 按当前角色状态自动取最大/最小值者，payload 以 `selection` 注明（如 `"highest(iron)=3"`）；`player_choice` 且未传 → 错误 `roll_selection_required` 并列合法项。
2. **action_roll**：经校验后的选择发起引擎事件（M4 起 stat/meter 可皆缺省，如 +rank 投）；结局文本按 outcomeKind 取出并展开 `{{table:...}}`。
3. **progress_roll**：须 track_id（缺省 → `invalid_input`）；special_track 的两个 move 由此路径走 legacy 轨（Overcome Destruction → `bonds_legacy`；Continue a Legacy → 三条 legacy 轨各掷一次，payload `rolls[]` 逐轨返回）。
4. **no_roll**：不掷骰；`move.text` 中的 `{{table:...}}` 一并展开（M3 仅展开 outcomes 文本，M4 修复覆盖 no_roll）。
5. **内嵌 oracle（`move.oracles`）**：
   - 文本/结局文本已引用的表由展开自动掷（计入 `nestedOracleRolls`）；
   - `oracle_id` 参数显式选择时必须 ∈ `move.oracles`（否则 `invalid_input` 列出候选），掷后在 `oracleRolls` 返回（Ask the Oracle 按几率五选一）；
   - 未被引用的余表恰剩 1 张 → 自动掷入 `oracleRolls`（如 Pay the Price 的 story_complication）；≥2 张 → payload `oracleCandidates` 列出候选，模型再以 `oracle_id` 或 `roll_oracle` 取用。

> **数据缺口**：Datasworn 0.0.10 无 Ask the Oracle 五张几率表节点，data 层按 Rules-Summary p6 阈值合成 yes/no 表（见 `DEVELOPMENT.md` §5.2），`oracle_id`/`roll_oracle` 因此可用；match 的极端结果提示由 `match` 标志承担。

### 5.2 make_move 资产联动（M5）

1. **asset_control / attached_asset_control 触发**（Companion Takes a Hit、Withstand Damage；内嵌 move Raise Shields 的 attached 形态）：
   - 合法集 = 拥有实例中匹配触发 glob（`assets` 模式，`*` 通配分类/资产段）且具备指定 control 的 condition_meter 实例；
   - 模型传 `asset_id`（实例 id）→ baseValue = 该实例 `meters[control]`，经引擎 `action_roll.assetMeter` 结算；
   - 未传且恰一个匹配 → 自动选定（payload `selection: "asset:<instanceId>(<control>)"`）；多个 → `asset_control_ambiguous` 列出候选；零个 → `asset_control_no_asset`；
   - 实例带 disables_asset 控制为真（out_of_action/broken）→ `asset_disabled`（提示先恢复/修理）。
   - M4 的 `asset_control_unsupported` 结构化拒绝随之移除。
2. **enhancements[]**：结算成功后附 `listEnhancements` 结果（instanceId/assetId/ability/text）；加值类提示模型以 `add` 重调或后续落地，重掷/骰后奖励按文本用既有工具补齐——引擎不自动应用，保持「骰后可选」的规则语义。
3. **资产内嵌 moves**：data 层注册的 12 个 move（id 形如 `starforged/assets/<cat>/<asset>/abilities/<n>/moves/<key>`）走同一分派；Seek Safe Haven（special_track）= discoveries_legacy 一掷（映射表增第三项）。

## 6. 系统提示词（prompt.ts）

三段拼接（每回合重建，不累积）：

1. **GM 行为规范**（固定文本，中英双份按叙事语言选择）：
   - 你是 Ironsworn: Starforged 的全自动 GM；玩家只扮演自己的角色。
   - 一切机制（掷骰、结算、数值变化）必须经工具执行；**永远不要自己编造骰值或宣布结算结果**（INV-1/2）。
   - 玩家行动命中 move 触发条件时调用 `make_move`；先 `get_move_detail` 查看触发选项；不确定时 `roll_oracle`。make_move 会对触发选择做校验：不合法的选择会被拒绝并列出合法项（M4）；asset_control 触发传 `asset_id`（M5），结算结果附 `enhancements[]` 时按文本与玩家确认后应用。
   - Ask the Oracle 以 `make_move` + `oracle_id`（五档几率表之一）结算；其余不确定处直接 `roll_oracle`。oracle 行文本内 `[label](id:…)` 引用的表（如剧情线索行的「描述词 + 焦点」）须逐张 `roll_oracle` 掷出并按行结构组合，不得重掷原表替代。
   - 结局文本是权威：strong/weak/miss 的叙述后果必须遵循；move 文本中的增益/损耗如需落地数值（如 +1 momentum、资产计量器增减）用相应工具补齐。结局给出选项（"Choose one"）时**先列选项请玩家选择，再按其选择用工具落地**；"on your next move" 类临时增益用 set_flag 记录，并在该次 make_move 以 add 传入。
   - **标记进度纪律**：结局文本出现"标记进度/mark progress"时（战斗 Strike/Clash/Gain Ground、场景挑战 Face Danger/Secure an Advantage、远征 Undertake an Expedition/Explore a Waypoint、Develop Your Relationship、Snipe Minor Foe 等），**必须立即以 `mark_progress` 在对应轨落地**——"标记两次进度"即 `marks: 2`，级别自动换算刻度（troublesome 12/dangerous 8/formidable 4/extreme 2/epic 1，封顶 40），legacy 轨不适用（走 adjust_legacy）。掷骰之外取得里程碑式进展（克服关键障碍、获得重要洞见、完成远征段、取得关键物品或资源、赢得重要支援、击败著名敌人）时，先经 make_move 调 `reach_a_milestone`（vow 轨）或 `develop_your_relationship`（connection 轨）再 `mark_progress`；End a Session 复盘补标。已挣得的进度不得让轨停留在 0。
   - **资产与经验（M5）**：购买/升级资产必须走 Advance——`add_asset(pay_with_experience=true)`（3 XP）或 `enable_ability(pay_with_experience=true)`（2 XP），经验不足会被引擎拒绝；legacy 进度自动累积 XP（快照 XP 行），**不得**叙述凭空获得资产或经验。誓言兑现/弃置、纽带成立用 `fulfill_vow`/`forsake_vow`/`forge_bond`（奖励自动入对应 legacy 轨），同伴/载具受伤经其资产计量器结算。
   - 每回合：叙事推进 + 必要工具调用；场景结束用 `end_scene`；重要转折写入 `add_journal_entry`。
   - 会话开场：新战役第一回合与每次继续游戏，先以 `make_move(begin_a_session)` 开局，再用相应工具落地其效果（如 +1 momentum）——不依赖模型自觉。
   - **玩家旗标（Set a Flag）**：旗标由玩家在向导设立并随快照下发；快照含 `FLAGS` 行时视为内容边界——回避该题材或仅以"擦过不细绘"的方式处理（Reframe/Refocus/Replace/Redirect/Reshape，见 Change Your Fate）；**绝不自行新增/修改/删除旗标**（`set_flag` 工具只用于场景事实记忆，与玩家旗标无关）。
   - **叙述风格（玩家可选预设，支持自定义）**：GM 规范"文风"段由模板占位符 `{STYLE_PARAGRAPH}` 注入对应风格句（runTurn `style` 参数 → buildSystemPrompt）：`classic` 标准（2–4 段紧凑叙述）、`concise` 简练（1–2 短段，先写发生了什么与代价，景物点到即止）、`literary` 沉浸（3–5 段，感官细节与氛围、角色内心）、`humorous` 诙谐（轻松打趣，但真正沉重的时刻不打趣）、`hardboiled` 冷硬（短促句、干脆、不煽情）；全部预设保留第二人称对玩家叙述、NPC 有动机与立场、回合结尾给出悬念或明确处境。另有 `custom` 自定义档（`NarrativeStyle` 联合类型含 `custom`，预设表 `NARRATIVE_STYLES` 仅含 5 预设）：runTurn `customStyle` 参数（web 设置透传）携带玩家自由文本，经净化（首尾去空白、`\s+` 折叠为单行、截断至 `CUSTOM_STYLE_MAX_LENGTH`=600 字符）后作为文风句注入——只替换风格句，模板其余固定文本（含"回合结尾给出悬念"与 CYOA/摘要尾注）不变；净化后为空则回退 classic。classic 文本与旧版逐字节一致；未知值回退 classic。
   - **回合摘要（Turn recap，始终启用）**：GM 规范追加 "Turn recap" 段——每回合收尾叙述之后、`<choices>` 块（如启用）之前，以 `<summary>…</summary>` 块给出恰好一句本回合概括（≤30 字/词：发生了什么+结局方向；无骰值细节、块内无多余文字）。块是 assistant 文本的一部分，随历史照常回传；UI 侧剥离后在消息下方以小字摘要常驻展示（§9），并作为历史压缩的摘要来源（§7）。文风句收尾由 CYOA 尾注承担：关闭 CYOA 时为"……然后附上 `<summary>` 摘要块"，开启时为"……然后附上 `<summary>` 摘要块与 `<choices>` 选项块"。
   - **玩家选项（CYOA，可选段）**：`buildSystemPrompt` 以 `{ cyoa: true }` 调用时追加 "Player choices (CYOA)" 段——每回合收尾叙述后以 `<choices>…</choices>` 块给出恰好 5 个具体、可执行、类型多样（行动/调查/交涉/恢复/非常规）的下一步选项，每行 `N. <选项> [Move 标记]`，块内无多余文字；文风句同步改写（"给出悬念后附选项块"而非"不要罗列选项菜单"）。**Move 标记**：每个选项行尾以半角方括号标注——选取将触发 move 的选项标 move 名（英文专有名词，如 `[Face Danger]`），纯剧情选项标 `[剧情]`（en：`[story]`）；待决选项（"Choose one"）以来源 move 名标记。关闭（默认）时不注入该段。块不进工具协议、不改历史结构——它只是 assistant 文本的一部分，随历史照常回传；web 端解析渲染为按钮，行尾标记解析为徽标（move 名经当前数据语言包解析为本地化名称、剧情标记按 UI 语言本地化，失败回退原文）并紧随选项文本展示、hover 显示该 move 的规则定义（复用 `.ds-tip` 悬浮卡：`index.byId` 取节点 → `describeDataswornNodeMarkdown` 转 markdown）、点击发送净文本（见 §9），解析失败原样显示。若刚结算的结局尚有待玩家选择的选项（"Choose one"），块中必须收录这些待决选项并**写明机械效果**（如"获得 +2 势头" / "下次行动 +1"），而非只给叙事后续——GM 规范的 "Choose one" 纪律同步要求：逐项列明效果、玩家未决前不落地效果、不推进剧情。
2. **状态快照**（buildSnapshot，紧凑行式）：
   - 角色：名字、五维 stats、meters、momentum（含 max/reset）、impacts、经验 XP（M5）；
   - 角色背景（`background` 非空时）：`BACKGROUND (player-written backstory — treat as canon): …`，空白折叠为单行；
   - **设定真相**（`truths` 非空时）：`TRUTHS` 段逐行列出 `- <truth 名>: <选项摘要>`——世界观正典每回合常驻，防止开场消息被历史截断后设定丢失（子表结果 truthDetails 不持久化、不入快照，仅存在于开场消息）；
   - **玩家旗标**（`contentFlags` 非空时）：`FLAGS (player-set boundaries): a ;; b`，置于角色行之后；
   - 资产（M4，M5 扩展）：`instanceId | assetId | 名称 | abilities n/3 | meters（integrity 3/5 等）| controls（battered/broken…）| →挂载目标`（无资产时省略）；
   - 轨道：`trackId | title | rank | ticks/40 (满格 n)`、legacy 三轨；
   - 场景：index、flags；最近 8 条 journal 摘要（kind + 一行文本/结局 kind+outcome）。
3. **目录树**（仅 id+名称，几 KB）：
   - moves：`分类名` 下每行 `id | 名称 | roll_type`；
   - oracles：树形缩进 `id | 名称`（71 rollable 全列，模型可自行 `get_oracle_detail`）。

预算参考：规范 ~600 tokens + 快照 ~450（含世界观 TRUTHS 段 ~150）+ moves 目录 ~1.2k + oracle 目录 ~1.5k ≈ 3.7–4k tokens 输入常量，随历史滚动增长。

## 7. Agent 循环（agent.ts）

```ts
runTurn({
  config, history, userInput,          // ChatMessage[]（不含 system，本回合内重建）
  executor, index, narrativeLanguage,  // 'zh' | 'en'
   cyoa = false,                        // CYOA 选项块提示词开关（web 设置项透传）
   style = 'classic',                   // 叙述风格预设（web 设置项透传；'custom' 时用 customStyle）
   customStyle?,                        // 自定义文风文本（style='custom' 时注入，净化后为空回退 classic）
  toolBudget = 12, maxHistoryMessages = 40,   // 上限即玩家可设置的 trimHistory（web 设置透传）
  fetchImpl?, onTextDelta?, onToolCall?, onToolResult?, signal?,
  onRequest?, onReasoningDelta?,       // 逐交互审计：请求快照 / 推理增量
}): Promise<{ messages: ChatMessage[]; toolCalls: TurnToolCall[]; usage: Usage; truncatedByBudget: boolean; interactions: TurnInteraction[] }>
```

1. `messages = [system] +（历史被截断时：一条回合内临时前情提要 system 消息）+ 滚动历史（截尾保序，保留 tool 配对完整性）+ { role:'user', content: userInput }`。
   - **前情提要（recap）**：`trimHistory` 截出的头部消息（cut 区）中，逐条 assistant 文本提取全部完整 `<summary>…</summary>` 块（空白折叠为单行；无块的旧消息跳过），取**最近 20 条**拼为一条 `{ role:'system', content: 'STORY SO FAR …\n- …' }` 临时消息插在 system 之后；cut 区一条摘要都没有则不注入（行为与旧版一致）。该消息**回合内临时**（每回合从完整 history 重新推导），与预算通知同理不写入返回的 `messages`（`finalize` 按 system+recap 前缀长度截除）——历史不丢不回滚，被截回合以摘要延续事实记忆。
2. `streamChat({ tools })`；文本增量经 `onTextDelta` 上抛（UI 流式渲染）。
3. 返回 `tool_calls` → 逐个执行（`onToolCall` → executor → `onToolResult`），追加 assistant(tool_calls) + tool 结果消息；回到 2。
4. 已执行工具数 ≥ `toolBudget` → 收尾请求：不带 `tools`，追加 system 提示「工具预算已用尽：不再调用工具，用现有结果总结本回合」。收尾响应仍可能试图带工具调用（少数模型违规）→ 忽略并在结果中标注。
5. 返回**完整**历史（cut 区 + 滚动窗口 + 本回合消息，不含 system/recap 临时消息；宿主保存为下一回合 history——截断只在每次请求时施加，被截消息不丢弃，其 `<summary>` 供后续前情提要复用；存档体积随战役时长线性增长属预期）；`usage` 累计本回合全部请求。
6. **逐交互审计（`interactions`）**：每轮请求前对拼接结果 `slice()` 出 messages 快照（消息对象创建后不可变，快照不被循环后续追加影响），连同 `tools` 有无记为一条 `TurnInteraction { round, messages, tools?, content, reasoning, toolCalls, finishReason, error? }`（请求失败时 `error` 带诊断、响应字段为已收到部分）。`onRequest` 在请求发出前上抛同一快照，`onReasoningDelta` 透传推理增量。web 据此在 GM 面板渲染「LLM 交互」审计；记录仅存内存、不入存档。

- 中断：`signal` 透传 fetch；abort 后已执行的工具结果保留（状态已变更，不回滚——引擎事件天然审计）。
- 流中断在工具循环间隙：已完成的 tool_calls 必须先回传结果再继续（协议要求配对），因此 abort 检查点放在「下一轮请求前」。

## 8. 测试矩阵（Vitest，注入 fetch / 种子 RNG）

1. `sse.test`：分帧、跨 chunk 粘包、`[DONE]`、tool_calls 增量聚合（乱序 index、arguments 分片）、usage 捕获、注释行忽略。
2. `client.test`（mock fetch）：正常流聚合；HTTP 401/404/500 诊断映射；网络 reject → network_error；tool_choice 降级链（仅 testConnection）；非流式探测成功判定。
3. `tools.test`：make_move 分派（face_danger=action_roll、一个 progress_roll move、no_roll、special_track 拒绝）、错误码回传 JSON、roll_oracle 真实表、未知 id 诊断；**M4 增**：trigger 校验（非法 stat → invalid_roll_selection+合法项）、highest 自动选值（endure_harm）、custom→add（develop_your_relationship）、special_track 双 move（bonds_legacy 一掷 / 三轨各一掷）、no_roll 文本展开（pay_the_price）、内嵌 oracle（make_a_discovery 自动掷、ask_the_oracle oracle_id 选择与候选、oracle_id 非法）、asset_control 结构化拒绝（companion_takes_a_hit）。
4. `agent.test`（伪模型 = 脚本化 streamChat 替身）：固定种子全流程「立誓(swear_vow) → Face Danger → roll_oracle → 负面结果 update_meter → end_scene」断言：状态变更、审计链、错误自纠（第一轮非法 move_id → 第二轮修正）、预算耗尽强制收尾、usage 累计。**前情提要**：截断时请求含 `STORY SO FAR` 临时 system 消息（仅 cut 区 `<summary>`、最近 20 条封顶、无摘要则不注入）且返回历史不含该消息；旧消息无 `<summary>` 块时跳过。**M5 增**：资产购买（add_asset 3 XP，不足拒绝自纠）→ 升级（enable_ability 2 XP）→ companion_takes_a_hit（asset_id 结算）→ fulfill_vow（legacy 奖励+移除轨+XP 累积）全链路。
5. INV：伪模型试图伪造骰值（直接叙述）不影响状态——状态 diff 只来自工具。
6. **M5 工具矩阵（tools.test 增）**：add_asset（XP 不足、挂载校验、未知资产）、enable_ability（requirement 格数断言、requirement_confirmed、重复启用）、adjust_asset_meter（battered 封锁、夹取）、set_asset_control（is_impact 拒绝）、discard_asset（连带清 impacts）、adjust_legacy（负刻度、XP 累积）、fulfill_vow/forsake_vow/forge_bond（miss 不清账、weak 需 confirmed）、mark_bond_decrease、update_track（清格/升档）；make_move asset_control（companion_takes_a_hit 自动选定、多实例 ambiguous、无资产 no_asset、disables 拒绝）、enhancements 出现在 payload（starship/铁壁类通配）、内嵌 move raise_shields（attached_asset_control）、seek_safe_haven special_track。

## 9. Web（M3 最小 UI，M4 向导与存档）

```
apps/web/src/
├── App.tsx               # 三栏布局壳 + 引导（加载数据 → 载入存档 | 新档向导）；向导页保留顶栏设置入口（§8.2/§8.3：设置菜单随时可开）
├── stores/settings.ts    # LlmConfig（自定义 baseUrl/key/model）+ 叙事语言 + 叙述风格 narrativeStyle（classic/concise/literary/humorous/hardboiled，默认 classic）+ 工具预算 + 历史上限 historyLimit（10–100，默认 40，透传 runTurn 的 maxHistoryMessages）+ CYOA 开关；localStorage('starwright.settings')，Key 不入存档
├── stores/campaign.ts    # zustand：CampaignState + index + audit 镜像；executeEvent → reduce → setState → 防抖落库
├── stores/chat.ts        # 叙事流状态；seedOpening() 注入向导拼装的开场输入
├── persistence/
│   ├── db.ts             # Dexie('starwright.v1')：saves 表（key='campaign'|'chat'）+ load/save(防抖 500ms)/clear
│   └── wizard.ts         # 向导输入 → NewCampaignInput（校验 stats 多重集、资产数量、truths 完整性）
├── features/settings/    # 自定义 baseUrl/key/model + 叙事/界面语言 + 叙述风格下拉 + 工具预算 + 历史上限（数字输入）+ 连接测试按钮 + 诊断展示 + 数据管理（删除存档）
├── features/wizard/      # M4 新档向导：Truths → 角色（名字/属性 {3,2,2,1,1}/背景誓约）→ 初始资产（Starship 固定 + 任选 3，Starship 不可再选，选后为空的分类隐藏）→ 开场
├── features/narrative/   # 聊天流（全部左对齐，玩家消息以蓝色左边框 + "You" 角标区分）：AI 流式文本、busy 等待气泡；同回合的工具结算合并为单条折叠 MechanicsStrip（点开为 SettlementCard）；错误/提示条；CYOA 选项块解析（cyoa.ts 纯函数：`splitChoices(text)` 剥离 `<choices>…</choices>` 并抽出编号行，行尾方括号 Move 标记（move 名或剧情标记）解析为 `ChoiceOption{text, tag?}`）——最后一条 GM 消息若含选项块且当前空闲，正文剥离后在其下渲染 5 个按钮（选项文本 + 紧随其后的小字标记徽标，move 名经当前数据语言包解析为本地化名称（`resolveMoveName`：先精确名匹配、再按 move id 尾段 slug 匹配，首中优先）、剧情标记按 UI 语言本地化，无标记的行照常渲染），点选即 `send(净文本（剥离标记）)` 作为普通玩家输入；流式中未闭合块从标记处起隐藏，完整块解析不出选项时原样显示（降级）；手动输入框不受影响；`<summary>` 块解析（summary.ts 纯函数 `splitSummary`，协议同 cyoa.ts：取最后一个完整块、剥离陈旧完整块、未闭合块从标记处隐藏）——GM 消息正文剥离后在其下以小字一行常驻展示本回合一句话摘要（无块则不显示）
├── features/character/   # 状态栏：stats/meters/momentum/轨道/impacts/资产（只读渲染；资产卡可展开查看全部 ability 文本与锁定状态）
└── features/gm-panel/    # 工具日志（每条 name/args/result/ok，可展开 audit 明细）+ LLM 交互审计（每轮推理文本 / 请求 messages+tools JSON / 模型回复；仅内存态）
```

- 结算卡片（SettlementCard）：**默认折叠为一行摘要**（move 名 + 结局徽标 + 骰值结论；oracle 卡为一行 d100 + 行文本），点开显示完整规则文本/骰值明细/内嵌 oracle 结果——叙事流保持简洁，原始 JSON 仍在 GM 活动面板。按 `EngineOutcome.kind` 渲染——action_roll 显示 action die/挑战骰/score/结局/是否 burn/负 momentum 取消（M5：assetMeter 来源行）+ **得分拆分行**——把得分逐项列出（`行动骰 X + 来源 Y + 加值 Z = 得分 S`）：来源为 stat/meter/assetMeter 的本地化标签与基值（stat 标签经 RuleTerm 术语表，assetMeter 显示实例 id + control），add 为 0 时省略；burn 时整行替换为 `动势 M（燃烧）`，负 momentum 取消骰时不计入并在行尾注明，raw 总分超出 [0,10] 被截断时附「原始 raw → 截断为 score」说明（纯函数 `scoreBreakdown.ts` + 单测，展示层不改动 outcome 模型）；progress_roll 显示 track/满格/挑战骰；oracle/adjust 类显示前后值；M5 的 asset_*/legacy XP 类显示实例名、计量器前后值与经验增量。M4：make_move 卡支持 `rolls[]`（Continue a Legacy 逐轨骰值）与 `oracleRolls` 展示——行文本同样经 `DataswornText` 渲染（`[label](id:…)` 转中性词 + 悬停定义，不显示原始标记，i18n 模板只承载 d100 前缀、不含 {{text}}）；表名经 `index.getOracle(tableId).name` 解析为**本地化表名**（zh 数据集为中文名，如「故事线索」），未命中回退 id 尾段，独立 oracle 卡摘要行同理（展开体保留完整 id 供审计）。目录工具卡（`get_move_detail`/`get_oracle_detail`）展开显示 move 全文（roll_type/触发/正文/三类结局文本/oracles 引用）或 oracle 全行区间表。Scene flag 卡展开显示完整值；值为字符串化 JSON 时**展示层自动解包**为紧凑 JSON（存储保持模型原样，不做改写）；`set_flag` 工具描述引导模型直接传 JSON 结构而非字符串。Journal entry 卡显示笔记文本（折叠单行摘要、展开全文）；`set_aboard_vehicle` 卡显示在船载具实例列表。
- **文本渲染约定（M4）**：工具结果内的 `{{table:...}}` 由引擎展开，`[text](id:node)` 与 `__bold__` 标记原样回传模型（可解析）；UI 展示时经共享渲染器把 `__x__` 转粗体、`[text](id:node)` 转带 id title 的中性文本（无跳转目标，不渲染原始语法）。GM 叙述按轻量 Markdown 渲染（`**粗体**`/`*斜体*`/`` `code` ``/无序列表/标题/引用；链接仅 http(s) 可点，非 http 的 `[](...)` 按中性文本），输出 React 元素、无 HTML 注入面。
- 工具日志条目：`{ seq, name, args, result|error, latency }`，与结算卡片互链（rollId）。
- 战役引导（M4）：无存档时进入向导（§8.2 流程）；完成后 `createNewCampaign`（truths/assets/backgroundVow 输入）→ 落库 → `seedOpening()` 以 truths summary + 背景誓约开场（quest starter 仅为玩家誓约灵感，不进入开场简报）——开场简报作为可折叠的「Campaign brief」卡片展示（不占用户气泡），全文作为首条 user 消息发给 GM；truths 另以 `TRUTHS` 段常驻每回合系统提示词快照（子表结果仅存于开场消息，不入快照）。有存档则经 `migrateCampaignState`（M5 v1→v2）载入继续。聊天流（entries/history/工具日志/usage）同库落库（key='chat'），刷新后恢复叙述；向导重开时清空。新战役开始时关闭 Settings/Mechanics log 等面板 UI 态（不带入新战役）。
- i18n（M6）：M4 界面文案仍英文；叙事语言可在设置选 zh/en（注入提示词）。

## 10. 变更同步

本文与 `DEVELOPMENT.md` §7.3、`docs/engine-design.md` 同步维护：新增工具必须先登记 §7.3；引擎事件/错误码变更以 engine-design 为准。每次 LLM 交互"发送什么 / 期望回什么"的逐条说明见 `docs/llm-interaction.md`。

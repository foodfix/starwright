# LLM 交互协议详解：发什么、期望回什么

> 本文档逐条说明游戏中每一次与 LLM 的交互：请求的完整构成（messages、tools、参数）与期望的返回（文本 / tool_calls / 纯文本）。
> 代码位置：`packages/ai/src/`（client.ts / agent.ts / prompt.ts / tools.ts / executor.ts / translate.ts）。
> 与 `docs/ai-design.md`（设计动机）、`DEVELOPMENT.md` §7（总览）同步维护。

## 0. 三类交互总览

| 交互 | 入口 | 流式 | 工具 | 期望返回 |
|---|---|---|---|---|
| 连接测试 | `testConnection`（client.ts） | 否 | 1 个探测工具 `report_ready` | 一次 `report_ready` tool_call |
| GM 回合循环（游戏主体） | `runTurn`（agent.ts） | 是 | 26 个引擎工具 | 每轮：叙事文本和/或 tool_calls；回合以纯文本收尾 |
| 规则文本翻译 | `translateText`（translate.ts） | 否 | 无 | 仅译文纯文本 |

所有交互都走 OpenAI 兼容的 `POST {baseUrl}/chat/completions`，请求头 `Content-Type: application/json`，配置了 API Key 时附带 `Authorization: Bearer <key>`（client.ts `buildHeaders`）。

---

## 1. GM 回合循环（runTurn）——游戏与 LLM 的主交互

玩家每发送一条输入触发一个"回合"。一个回合 = **一至多轮**请求/响应：模型调用工具 → 游戏执行 → 结果回传 → 再次请求，直到模型输出纯文本收尾（或预算耗尽强制收尾）。

### 1.1 第一轮请求：发送什么

```
POST {baseUrl}/chat/completions
{
  "model": "<用户配置的模型名>",
  "stream": true,
  "stream_options": { "include_usage": true },
  "messages": [ system, 前情提要[截断时], ...滚动历史, 本回合用户输入 ],
  "tools": [ 26 个工具的 JSON Schema 定义 ]
}
```

#### messages[0]：system（每回合重建，不累积）

由 `buildSystemPrompt`（prompt.ts）拼接四段：

1. **GM 行为规范**（中/英固定文本，按叙事语言选择）——权威规则（机制必须走工具、不得自编骰值、结局文本是权威、选项先问玩家——逐项写明机械效果、玩家未决前不推进剧情，启用 CYOA 时待决选项须纳入 `<choices>` 块、资产/经验/誓言纪律、每会话先 `begin_a_session` 开局）+ 玩家旗标纪律（快照含 `FLAGS` 行时回避或淡化处理该题材，绝不自行改动旗标）+ 文风要求（按玩家设置的**叙述风格预设**注入：`classic` 标准 2–4 段紧凑叙述 / `concise` 简练 1–2 短段 / `literary` 沉浸 3–5 段 / `humorous` 诙谐 / `hardboiled` 冷硬，默认 classic；预设 `custom` 时改注入玩家自定义文风文本——空白折叠为单行、≤600 字符、空白回退 classic；全部预设第二人称、以悬念收尾）+ **"Turn recap" 段（始终启用）**：要求收尾叙述后以 `<summary>…</summary>` 块给出恰好一句本回合概括（≤30 字/词，`<choices>` 块之前）。启用 CYOA（玩家在设置中开启，`buildSystemPrompt` 的 `{ cyoa: true }` 选项）时再追加 **"Player choices (CYOA)"** 段：要求摘要块之后以 `<choices>…</choices>` 块追加恰好 5 个具体可选行动（每行 `N. <选项> [Move 标记]`，见 §1.4）；同时文风句由"不要罗列选项菜单"改为"给出悬念后附 `<summary>` 摘要块与 `<choices>` 块"。关闭 CYOA 时仅无 CYOA 段（recap 段常驻）。
2. **`## CURRENT STATE` 状态快照**（`buildSnapshot`，紧凑行式）：
   - `CHARACTER` 行：名字、五维 stats、health/spirit/supply、momentum（含 max/reset）、impacts、XP；
   - `BACKGROUND` 行（`character.background` 非空时）：玩家自写角色背景，空白折叠为单行，标注为必须遵循的设定正典；
   - `TRUTHS` 段（`truths` 非空时）：战役开场确立的各条 Setting Truth（`- <truth 名>: <选项摘要>`），世界观正典每回合常驻——即使开场 user 消息被 `trimHistory` 截出历史，模型仍能看到设定；子表结果（truthDetails）不持久化、不入快照，仅存在于开场消息；
   - `FLAGS` 行（`contentFlags` 非空时）：玩家在向导设立的旗标（Set a Flag），`a ;; b` 形式；
   - `ASSETS` 行：每个实例 `instanceId | assetId | 名称 | abilities n/3 | meters | controls | attached`；
   - `TRACKS`：每条 `trackId | title | rank | ticks/40 [满格数] (kind)`；
   - `LEGACY`：quests/bonds/discoveries 三轨刻度；
   - `SCENE`：场景序号与 flags；
   - `RECENT JOURNAL`：最近 8 条日志摘要。
3. **`## MOVE CATALOG`**：全部 move 的 `id | name | roll_type`（按分类分组）。
4. **`## ORACLE CATALOG`**：全部 oracle 表的 `id | name | path`。

> 目录只含 id 与名称（几 KB）；move/oracle 全文由模型按需调 `get_move_detail` / `get_oracle_detail` 获取。

#### messages[1..n]：滚动历史（不含 system）

上一回合返回并保存的 `messages`（assistant 文本、assistant.tool_calls、tool 结果、user 输入）。每回合经 `trimHistory` 截到最近 `maxHistoryMessages` 条（玩家可设置，默认 40），截断时**保持 tool 配对完整**：不会让 `role:"tool"` 消息失去其 `assistant.tool_calls` 前驱（agent.ts `trimHistory`）。

**前情提要（可选的 messages[1]）**：仅当本次确有消息被截出历史时注入，插在 system 之后、滚动窗口之前，是一条**回合内临时** system 消息（不写入保存的历史，每回合从完整 history 重新推导）。内容为 cut 区各 assistant 文本中提取的 `<summary>` 一句话概括（最多最近 20 条，`- ` 逐行列出），标题行按叙事语言（`STORY SO FAR (one-line recaps of earlier turns no longer in context):` / 中文对应）——被截出上下文的回合以摘要延续事实记忆，正文不再占用 token。cut 区无任何 `<summary>`（旧存档或模型漏写）则不注入。

#### 最后一条：本回合玩家输入

`{ "role": "user", "content": "<玩家输入>" }`。

**新战役第一回合的特殊输入**：向导完成后由 `buildOpeningPrompt`（apps/web/src/persistence/wizard.ts）合成开场 brief，内容为：
- `Begin the campaign: this is the opening scene...`；
- `Setting truths:` + 玩家选定的每条 Setting Truth（`- <truth 名>: <选项摘要>`；若玩家在向导内为该选项的子表选/掷了结果，追加 ` (<子表行文本>)`）；
- 背景誓言（若有）：`Background vow (<rank>): "<誓言>" — it exists as a vow track already; weave it into the opening.`；
- `Open scene 1: introduce the situation, then hand control back to the player.`

它在 UI 上以折叠的"开场"条目渲染，但对模型就是一条普通 user 消息。其中的 truths 同时以 `TRUTHS` 段常驻每回合系统提示词快照（见上），开场消息被截出历史后世界观正典不丢失。

#### tools：26 个工具的 JSON Schema

完整清单见 `packages/ai/src/tools.ts`（`TOOL_SPECS`）与 `DEVELOPMENT.md` §7.3。每条含 `name`、`description`、`parameters`（JSON Schema，`additionalProperties: false`）。这告诉模型**能调什么、传什么参数**；机制结果由游戏引擎执行，模型无权直接改状态。

### 1.2 每轮响应：期望收到什么

流式 SSE 响应（`data:` 帧，`[DONE]` 结束），`sse.ts` 增量聚合成两类内容，模型每轮**至少给出其一**：

1. **`content` 文本**：面向玩家的叙事（流式增量经 `onTextDelta` 上抛给 UI 逐字渲染）。期望符合系统提示词文风：2–4 段、第二人称、结算含义遵循工具返回的结局文本、结尾给出悬念。
2. **`tool_calls`**：数组，每项 `{ id, type: "function", function: { name, arguments } }`，`arguments` 是**JSON 字符串**（GLM/Qwen 系网关的非标准 `<arg_key>/<arg_value>` 标签或重复键格式由 `args.ts` 归一化，解析仍失败则回传 `invalid_json` 错误供自纠）。期望 `name` ∈ 26 个注册工具，参数符合该工具 schema。

推理模型（GLM/DeepSeek 系等）会在增量中附带推理内容：`delta.reasoning_content`（部分网关写作 `delta.reasoning`）。`sse.ts` 将其聚合为完整推理文本，经 `onReasoningDelta` 实时上抛；**仅作透传展示，不写入历史、不回传模型**。非推理模型无此字段（聚合为空串）。

另外收集 `finish_reason` 与 `usage`（prompt/completion tokens，累计展示）。

### 1.3 有 tool_calls 时：游戏做什么、再发什么

对每个 tool_call（按序）：

1. 解析 `arguments` → 在引擎上执行（`executeToolCall`，executor.ts；状态变更只能经引擎 `reduce`）；
2. 把执行结果序列化为 JSON 字符串，作为**下轮请求**的追加消息回传：

```
assistant 消息：{ role: "assistant", content: <本轮文本或 null>, tool_calls: <原样回显> }
tool 消息：    { role: "tool", tool_call_id: <call.id>, name: <工具名>, content: <结果 JSON> }
```

**`content` 的两种形态**（`toolResultContent`）：

- 成功：该工具 payload 的 JSON（见 §2 各工具返回结构）；
- 失败：`{"error":{"code":"...","message":"...","hint":"..."} }` —— hint 列出合法取值/修法，**期望模型据此修正参数重试**（错误自纠循环）。

然后立即发起下一轮请求（messages = 上述追加后的完整序列，tools 不变）。

### 1.4 回合如何结束

- **正常收尾**：某轮响应只含文本、无 tool_calls → 该文本作为 assistant 消息并入历史，回合结束。期望该收尾文本依次以 `<summary>` 摘要块（始终）与 `<choices>` 块（启用 CYOA 时）结束；摘要块协议同下述选项块——是 assistant 文本的一部分，随历史照常回传模型，UI 剥离后以小字摘要在消息下方常驻展示，并作为历史被截断时的前情提要来源（见 §1.1）。启用 CYOA 时，期望该收尾文本以 `<choices>` 块结束：

  ```
  <choices>
  1. <选项一> [Move 名]
  2. <选项二> [剧情]
  3. <选项三> [Move 名]
  4. <选项四> [Move 名]
  5. <选项五> [剧情]
  </choices>
  ```

  块的**协议约定**：不进工具协议、不改历史格式——它就是 assistant 文本的一部分，随历史照常回传模型（下一回合模型能看到自己上回合给过的选项）；UI 侧将其从叙述正文中剥离并渲染为 5 个可点击按钮，玩家点选即以该文本（**剥离标记后的净文本**）作为普通 user 输入开启下一回合，也可无视选项自由输入。`<choices>` 块缺失或行格式不符时 UI 原样显示文本（优雅降级），无需重试。
- **选项标记（Move 标注）**：每个选项行以半角方括号标记收尾——选取该选项将触发某个 move 时，标记写该 **move 名**（专有名词保留英文原文，如 `[Face Danger]`、`[Compel]`、`[Enter the Fray]`）；纯推进剧情、不涉机制的选项标记为**剧情标记**（中文叙述 `[剧情]`，英文叙述 `[story]`）。刚结算结局的待决选项（"Choose one"，须写明机械效果）以其来源 move 名标记。标记是提示的一部分而非独立协议字段：UI 侧解析**行尾**方括号内容为徽标（不识别中缝出现方括号的选项），move 名标记经**当前数据语言包**（`starforged.zh.json` 的 move 名称，先精确名匹配、再按 move id 尾段 slug 匹配）解析为本地化名称，剧情标记按 UI 语言本地化；解析失败回退显示原文。徽标**紧随选项文本**展示（非按钮右缘），hover 徽标经 `index.byId` + `describeDataswornNodeMarkdown` 以 `.ds-tip` 悬浮卡显示该 move 的规则定义（同富文本链接悬停，见 ai-design.md §9），点击按钮只发送净文本；无标记的行照常渲染（兼容旧格式/漏写，优雅降级）。
- **预算收尾**：本回合累计工具调用 ≥ `toolBudget`（默认 12）→ 追加一条回合内临时 system 消息（中文："本回合工具预算已用尽：不要再调用任何工具……" / 英文对应），且**下一轮请求不再携带 `tools` 字段**。期望模型只输出收尾叙述；该临时 system 消息不写入滚动历史。若模型违规仍返回 tool_calls：不执行，逐个回传 `{"error":{"code":"tool_budget_exhausted",...}}` 再请求一次。
- **出错收尾**：请求抛 `LlmError`（401/404/429/网络/中断等，见 client.ts 诊断映射）→ 给最后一条未应答的 tool_calls 补发错误 tool 消息（保持历史配对合法），回合以 `error` 诊断结束。中断（abort）时已执行的工具结果保留、状态不回滚。

### 1.5 回合返回给游戏什么

`runTurn` 返回 `{ messages, toolCalls, usage, truncatedByBudget, error?, interactions }`：`messages` 是去掉 system/recap 临时消息后的**完整**历史（含已被截出请求窗口的旧消息——截断只在请求时施加，其 `<summary>` 摘要供后续前情提要复用；宿主存为下回合 history），`toolCalls` 是本回合全部工具执行记录（seq/name/args/execution/回传内容，UI 渲染为"机制条"），`interactions` 是本回合逐轮交互审计记录（见 §1.6）。

### 1.6 逐交互审计：怎么查"发了什么 / 模型想了什么"

`runTurn` 每发起一次请求都记录一条 `TurnInteraction`（agent.ts，随 `TurnResult.interactions` 返回，按轮序排列）：

| 字段 | 内容 |
|---|---|
| `round` | 回合内轮次（0 起） |
| `messages` | **本次请求实际发送的 messages 快照**（发送前对拼接结果 `slice()`；消息对象创建后不可变，快照不受循环后续追加影响） |
| `tools` | 本次请求提供的 26 个工具 schema（预算收尾请求为 `undefined`） |
| `content` / `reasoning` | 该轮模型返回的叙事文本与推理内容（`reasoning_content`/`reasoning`；非推理模型为空串） |
| `toolCalls` / `finishReason` | 该轮模型请求的工具调用与结束原因 |
| `error?` | 该轮请求失败时的诊断（此时 content/reasoning 为已收到部分或空） |

配套回调（宿主可选）：`onRequest`（每轮请求发出前上抛 `{ round, messages, tools }` 快照）与 `onReasoningDelta`（推理增量实时上抛，与 `onTextDelta` 同构）。

Web 侧：「LLM 交互」审计挂在**对应行动下面**——叙事流中本回合 GM 回复（assistant 消息）下方有一个默认隐藏的「LLM 交互」胶囊开关（`NarrativeView`，锚定在 store 的 `interactionAnchorId`），点击弹出 pop-up 窗口（`InteractionPopup`，遮罩点击 / Esc / 关闭按钮均可关闭），按轮倒序展示**推理文本、请求 JSON（messages + tools）、模型回复**；回合进行中也可点开，推理增量实时滚入。右栏不再单独设「LLM 交互」区块（GM 活动面板仅保留工具调用日志）。该数据仅存内存（不入 Dexie 存档，避免保存文件膨胀），刷新后开关消失属预期。

---

## 2. 工具级协议：参数与期望的返回 JSON

以下"返回"指写入 tool 消息 `content` 的 payload（模型会读到）。全部工具的**参数 schema** 见 tools.ts，此处列关键入参与返回结构。

### make_move（结算 move）

- 发送参数：`move_id`（必填）+ 触发选择（`stat` / `meter` / `add` / `track_id` / `asset_id` 之一，按 move 类型）+ 可选 `oracle_id`（选择 move 内嵌表，如 Ask the Oracle 五档几率）。
- 期望返回（成功，action_roll 例）：
  ```json
  { "move": {"id","name","roll_type"},
    "outcomeKind": "strong_hit|weak_hit|miss",
    "engineOutcome": { /* 骰值、score、challenge dice、momentum 消耗等权威数值 */ },
    "text": "<该结局的规则原文，内嵌 {{table:...}} 已代掷并展开>",
    "nestedOracleRolls": [{"tableId","roll","text"}],
    "oracleRolls": [{"tableId","roll","text"}],
    "oracleCandidates": ["<可选：多个内嵌表未决时列出候选 id，期望模型选定或问玩家>"],
    "selection": "highest(wits)=2  /* 自动选值时的说明，仅自动解析时出现 */",
    "enhancements": [ /* 资产 ability 提供的加值/重掷选项，期望告知玩家后落地 */ ] }
  ```
- 常见错误（自纠）：`invalid_roll_selection` / `roll_selection_required`（hint 列出合法 `stat:…, meter:…, add:…` 选项）、`asset_control_no_asset` / `asset_control_ambiguous`、`unknown_move`、`oracle_id` 不属于该 move 时的 `invalid_input`。
- 语义约定：结局文本与 `engineOutcome` 是**权威**——期望模型按其含义叙述，不重掷、不改数；"Choose one" 类结局先**逐项列出选项并写明各自机械效果**（如"获得 +2 势头" / "下次行动 +1"），请玩家明确选择后再落地，玩家未决前不得推进剧情；启用 CYOA 时把这些待决选项纳入 `<choices>` 块（写明效果），而不是只给叙事后续。结局文本出现"标记进度/mark progress"时（Strike/Clash/Gain Ground、场景挑战 Face Danger/Secure an Advantage、Undertake an Expedition/Explore a Waypoint、Develop Your Relationship 等），期望模型**立即以 `mark_progress` 在对应轨落地**（"标记两次"→ `marks: 2`）；里程碑式进展先经 `make_move` 调 `reach_a_milestone` / `develop_your_relationship` 再标进度，End a Session 复盘补标。

### roll_oracle

- 参数：`table_id`。期望返回：`{"tableId","roll"(d100),"match","text"(行文本，嵌套表已代掷),"suggestion","nested":[...]}`。
- 行文本含 `[label](id:…)` 引用的其他表时（如剧情线索 95 行「描述词 + 焦点」）：期望模型**逐张 `roll_oracle` 掷出被引用的表**并按行结构组合成结果；不得以重掷原表替代。

### get_move_detail / get_oracle_detail（只读）

- 参数：`move_id` / `table_id`。期望返回：move 全文（`trigger`、`text`、`outcomes{strong_hit,weak_hit,miss}`、`oracles`）或表全行（`rows:[{min,max,text}]`）。无状态副作用。

### 状态变更工具（与引擎事件同名）

`adjust_meter`、`adjust_momentum`、`burn_momentum`、`mark_impact`、`clear_impact`、`add_track`、`swear_vow`、`mark_progress`、`adjust_legacy`、`update_track`、`mark_bond_decrease`、`add_asset`、`discard_asset`、`enable_ability`、`adjust_asset_meter`、`set_asset_control`、`set_flag`、`add_journal_entry`、`end_scene`：

- 期望返回：对应引擎 outcome 的 JSON（含 before→after 数值、trackId/ticks、asset 实例、XP 变化等，形状见 engine 的 outcome 类型），例如 `adjust_momentum` 返回 `{"delta","+1","before":2,"after":3,"momentumMax":10}` 摘要语义。
- `fulfill_vow` / `forsake_vow` / `forge_bond` 返回额外字段：`legacyReward`（入轨刻度）、`trackRemoved`、miss/weak 时的 `note`（指示向玩家提供弃誓/重誓/confirmed 再调等选项）。
- 引擎拒绝时返回 `{error:{code,message,hint}}`（如 XP 不足、battered 封锁恢复、impact 不可清除），期望模型换合法路径。

---

## 3. 连接测试（testConnection）——非游戏交互

**发送**：非流式请求，`tools: [report_ready]`（无参工具），`tool_choice` 按降级链逐次尝试：`{"type":"function","function":{"name":"report_ready"}}` → `"required"` → `"auto"`（网关拒绝强制模式时降级）；`messages` 固定为 system `"You are a connectivity probe. Call the report_ready function now."` + user `"ping"`，`max_tokens: 512`。

**期望返回**：`choices[0].message.tool_calls` 中出现 `name === "report_ready"` 即通过。全部失败则返回诊断（`no_function_calling` / `auth_failed` / `network_error` 等）。此交互不进入游戏历史。

---

## 4. 规则文本翻译（translateText）——辅助交互

UI 内按需翻译 Datasworn 规则文本（如 move/oracle 详情）时调用，走 `completeOnce` 非流式、**不带 tools**，`max_tokens` 默认 1024。

**发送**：

```
system: "You translate game rule text for the Ironsworn: Starforged RPG.
Translate faithfully and concisely. Preserve inline markup verbatim:
__bold__ markers, [label](id:...) links and {{table:...}} templates must
survive unchanged. Return ONLY the translated text, with no notes or explanations."
user:   "Translate into Simplified Chinese (简体中文) | English:\n\n<待译文本>"
```

**期望返回**：`choices[0].message.content` = **仅译文**；行内标记（`__粗体__`、`[label](id:...)` 链接、`{{table:...}}` 模板）原样保留。空串视为 `malformed_response`。此交互不进入游戏历史（调用方负责缓存）。

---

## 5. 历史与上下文规则速查

| 规则 | 值 | 说明 |
|---|---|---|
| system 重建 | 每回合 | 快照总是最新状态，不依赖模型记忆数值 |
| 历史上限 | 40 条消息 | `trimHistory` 保 tool 配对 |
| 工具预算 | 12 次/回合（可配置） | 超出 → 无 tools 收尾请求 |
| 上下文控制 | 全文按需 | 目录常驻，详情走 `get_*_detail` |
| token 统计 | 每回合累计 | `stream_options.include_usage` / 非流式 `usage` |

## 6. 变更同步

本文与 `docs/ai-design.md`、`DEVELOPMENT.md` §7 同步维护：新增/修改工具、系统提示词段落、消息组装或返回结构时，先改本文与 ai-design，再改代码。

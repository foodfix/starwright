# Starwright 总开发文档

> 本文档是 Starwright 项目的**唯一权威开发规范**。实施过程中如与本文冲突，先修订本文再动代码。
> 原始规划见会话计划文件《Starforge — AI 全自动 GM 的 Ironsworn: Starforged 网页 RPG》（项目当时名为 Starforge），本文为其展开版。

> **更名记录（2026-09-19）**：项目由 `starforge` 更名为 **Starwright**，定位副标题 *An AI Game Master for Ironsworn: Starforged*。原因：原名与官方游戏 *Ironsworn: Starforged* 过于接近（Tomkin Press 许可明确禁止声明或暗示官方产品，详见 §13），且与既有商业产品撞名（CodeHatch 的 Steam 游戏 *StarForge*、OTK Media 的 *Starforge* 整机品牌）。同步变更：pnpm workspace scope `@starforge/*` → `@starwright/*`；localStorage 键 `starforge.settings.v1`/`starforge.translations.v1` → `starwright.*`；Dexie 库名 `starforge.v1` → `starwright.v1`（**破坏性变更**：旧浏览器本地存档与设置不会自动迁移）；导出存档标记 `kind: 'starforge-save'` → `'starwright-save'`（导入仍兼容旧标记）。游戏数据文件名 `starforged*.json`、Datasworn id 前缀 `starforged/…` 与类型 `StarforgedIndex` 指游戏官方数据，**不**随项目名变更。

---

## 1. 项目定位

开源（中英双语）网页单人 RPG：AI 扮演 GM 负责叙事与决策，**规则引擎负责一切机制结算并拥有唯一权威**。AI 通过 tool-calling 驱动引擎，玩家以自由文字扮演自己的角色。

**核心不变量（所有设计必须服从）：**

- INV-1：一切机制数值变化只发生在引擎内部；AI 只能通过定义好的工具间接改状态，永远不能直接给出骰值或结算结果。
- INV-2：掷骰由引擎执行（可注入种子的 RNG），AI 与 UI 都只是消费结算结果。
- INV-3：游戏数据（moves/oracles/assets/truths）来自 Datasworn `starforged.json`，代码库不复制 PDF 文本。
- INV-4：引擎包（`packages/engine`）无 DOM、无网络、无 React 依赖，可独立测试与复用。

**非目标（MVP 明确不做）：** 多人联机、后端服务（轻量 LLM 代理列 v2）、移动端原生 App、Ironsworn 经典版规则、`atlas/rarities/delve_sites` 等空数据域。

---

## 2. 已确认决策

| 决策点 | 结论 |
|---|---|
| 项目名称 | **Starwright**（2026-09-19 定名，原名 `starforge` 因与官方游戏 Starforged 及既有商业产品撞名而弃用，见文首更名记录） |
| 产品形态 | AI 叙事 RPG 游戏（AI 全自动 GM） |
| 平台 | Web SPA，纯前端，无后端 |
| LLM | OpenAI 兼容单协议（streaming + function calling），用户自带 API Key；**只支持自定义 endpoint（baseUrl/key/model），无内置 provider 预设**（M4 修订：预设列表与示例 endpoint 全部删除） |
| AI 分工 | AI 全自动 GM：决定行动、选择动作、调用工具；掷骰与结算由引擎执行，AI 不可篡改结果 |
| 模式 | MVP 纯单人；数据模型预留多角色扩展 |
| 前端 | React 18 + Vite + TypeScript + Zustand |
| 规则范围 | 全量自动化：moves、oracles、assets（含 enhance_moves/条件计量器/触发器）、impacts、legacy、truths |
| 语言 | 中英双语 i18n（zh/en 文案包）；AI 叙事语言可切换；游戏数据随 UI 语言加载：zh 加载预翻译 `starforged.zh.json`，en 加载英文原文；"AI 翻译"按钮保留为兜底 |
| 公开部署 | 静态托管公开站点，玩家自带 API Key 费用自担；轻量 LLM 代理（服务端藏 Key + 限流）列入 v2 |
| 许可 | 代码 MIT；游戏内容 CC-BY 4.0，README/关于页标注 Shawn Tomkin / Ironsworn: Starforged / Datasworn 来源 + 非官方免责声明（不声明或暗示官方产品，见 §13） |

---

## 3. 技术栈与工程约定

- **运行时/语言**：Node ≥ 20，TypeScript `strict: true`（含 `noUncheckedIndexedAccess`），ESM。
- **包管理**：pnpm workspace（`pnpm-workspace.yaml` 覆盖 `apps/*`、`packages/*`）。
- **构建**：Vite（仅 apps/web）；packages 用 TS 项目引用或 tsc 直出，不打包重复依赖。
- **测试**：Vitest（单测 + property 测试）；集成脚本用伪模型跑全流程。
- **代码风格**：ESLint（typescript-eslint 推荐集）+ Prettier（单引号、分号、100 列）；提交前 `pnpm lint && pnpm typecheck && pnpm test` 必须全绿。
- **CI**：GitHub Actions：lint + typecheck + test（Node 22 LTS；Node 20 已于 2026-04 EOL，`engines` 仍为 `>=20`）。
- **依赖原则**：运行时依赖尽量少——data/engine 包 0 运行时依赖（zod 仅用于 schema 校验）；AI 包用 `fetch` 自实现 OpenAI Chat Completions 协议（不引入官方 SDK，便于浏览器直连与流式控制）；UI 层 react/react-dom/zustand/dexie/react-i18next。

---

## 4. 仓库结构

```
starwright/
├── apps/web/                 # React + Vite UI
│   └── src/
│       ├── app/              # 应用壳、路由、布局
│       ├── features/         # narrative/ character/ assets/ gm-panel/ wizard/ settings/
│       ├── stores/           # Zustand stores（ui / campaign 门面）
│       ├── i18n/             # zh/en 文案包
│       └── persistence/      # Dexie 存档、导入导出
├── packages/engine/          # 纯 TS 规则引擎（权威结算）
│   └── src/
│       ├── state/            # CampaignState 定义与 reducer
│       ├── dice/             # RNG、动作骰/进度投结算
│       ├── moves/            # move 触发与结算
│       ├── tracks/           # progress/legacy 轨
│       ├── assets/           # 资产自动化
│       └── oracle/           # oracle 掷表（二分查找）
├── packages/data/            # Datasworn 加载器：zod 校验 + 索引
├── packages/ai/              # OpenAI 兼容客户端 + GM agent 循环 + 工具定义
├── data/starforged.json      # Datasworn 0.0.10 数据（原样保留，只读）
├── pdfs/                     # 官方 PDF（只读参考，不进构建）
└── docs/                     # 本文档与后续设计文档
```

---

## 5. 数据层设计（packages/data）

### 5.1 数据源事实（已勘察确认）

`data/starforged.json`（约 53,000 行，Datasworn 0.0.10，CC-BY 4.0）顶层键：
`rules / oracles / assets / atlas / moves / npcs / rarities / delve_sites / site_domains / site_themes / truths`。
其中 `atlas / rarities / delve_sites / site_domains / site_themes / npcs` 为空或 Ironsworn 遗留，**显式跳过**。

关键结构（zod schema 按此建模）：

- `rules`：`stats`（edge/heart/iron/shadow/wits）、`condition_meters`（health/spirit/supply，0–5，max=5）、`impacts`（按类别分组：misfortunes / vehicle_harm / wraith 等，含 `shared` 标记；车辆类 impact 仅在载具场景生效）、`special_tracks`（quests/bonds/discoveries legacy 轨）、`tags`（region/location 等）。
- `moves.<category>.contents.<move_id>`：move 节点含
  - `roll_type`（action_roll / progress_roll / no_roll / **special_track**，后者用于含特殊轨的 move，引擎层按特殊轨建模）；
  - `trigger.conditions[]`：`method`（player_choice / progress_roll / highest / lowest / all，可为 null）+ `roll_options[]`（`using` ∈ stat / condition_meter / progress_track / custom / asset_control / bonds_legacy / quests_legacy / discoveries_legacy + 对应字段）；
  - `outcomes.{strong_hit,weak_hit,miss}.text`（可整体为 null，如 no_roll move；文本含 `[链接](id:...)` 与 `{{table:...}}` 引用语法，后者指向 oracle rollable id）。
- `oracles.<category>.contents`：嵌套 `oracle_collection` / `oracle_rollable`；rollable 含 `dice`（骰型声明：数据集为 1d100 / 1d20 / 1d10）与 `rows[]`（`min/max/text`，区间覆盖 1..N，N=声明骰面数），文本支持 `{{table:...}}` 嵌入与 `suggestion` 字段。
- `assets.<category>.contents.<asset_id>`：含 `abilities[]`（`enabled`、`text`、`enhance_moves[]`（`roll_type/enhances[]`）、内嵌 moves、条件计量器与 `controls`）、`options`（field_type ∈ text / select_value）、`count_as_impact`、`shared`、`attachments`；`controls` 值类型 field_type ∈ condition_meter / checkbox / card_flip。
- `truths.<key>`：14 类（cataclysm/exodus/communities/iron/laws/religion/magic/communication_and_data/medicine/artificial_intelligence/war/lifeforms/precursors/horrors），`options` 以数字字符串为键（'0'…），选项含 `summary/description/quest_starter` + 内嵌子表 `table`；子表自身无 `_id`，`{{table:...}}` 以合成 id `starforged/truths/<key>/<optionKey>` 引用。

### 5.2 职责

1. **加载**：浏览器端 `fetch('starforged.json')`（Vite 将其作为静态资源放进 `dist/`，启动时加载并常驻内存）。
2. **校验**：zod 定义 Datasworn 子集 schema；未知键透传忽略；空域显式跳过并记录 warning。
3. **索引**（`StarforgedIndex`）：
   - `byId: Map<string, AnyNode>` 平铺索引（含按 `starforged/truths/<key>/<optionKey>` 合成 id 注册的 truth 子表，供 `{{table:...}}` 解析）；
   - **M4 数据缺口修正**：Datasworn 0.0.10 缺失 Ask the Oracle 的五张几率表（move.oracles 引用悬空）——按 Rules-Summary p6 机制阈值（yes ≤ 10/25/50/75/90）合成为 `starforged/oracles/moves/ask_the_oracle/{small_chance,unlikely,fifty_fifty,likely,almost_certain}` yes/no 表并注册进索引；
   - move 分类树（category → moves，仅 id+name+roll_type，供提示词与 UI 目录）；
   - oracle 分类树（collection → rollable，含路径面包屑）；
   - oracle 表 `rows` 预处理为按 `min` 升序的区间数组，供二分查找（`findRowByRoll(rows, roll)`）；
   - asset/truth 索引。
4. **导出 API**（纯函数，无副作用）：

```ts
loadStarforged(raw: unknown): { index: StarforgedIndex; warnings: string[] }
index.data: Starforged                       // 解析后的全量数据（rules/moves/oracles/assets/truths）
index.byId: ReadonlyMap<string, AnyNode>
index.getMove(id): MoveNode | undefined
index.listMoves(): MoveCategoryNode[]
index.getOracle(id): OracleRollable | undefined
index.getOracleRows(id): OracleRow[] | undefined  // 预处理后的有序区间
index.listOracleTree(): OracleCollectionNode[]
index.getAsset(id): AssetNode | undefined
index.listAssetTree(): AssetCategoryNode[]   // M4：分类树（id+name+asset 摘要），供向导与 UI
index.getTruth(key): TruthNode | undefined
index.listTruths(): TruthNode[]
findRowByRoll(rows: OracleRow[], roll: number): OracleRow | undefined
```

---

## 6. 引擎层设计（packages/engine）——唯一权威

### 6.1 状态模型

```ts
interface CampaignState {
  version: number;                         // 存档迁移用（当前 4；v1–v3 存档经 migrateCampaignState 升级）
  truths: Record<TruthKey, TruthChoiceId>;
  characters: CharacterState[];            // MVP 长度 1，预留多角色
  activeCharacterId: string;
  tracks: Record<TrackId, ProgressTrack>;  // 誓言/战斗/远征等场景轨
  legacy: Record<LegacyKey, LegacyTrack>;  // quests/bonds/discoveries
  assets: AssetInstance[];                 // 实例化资产（M5：计量器/controls/attachment 全自动化）
  experience: number;                      // M5：已赚取未花费的经验（Earn Experience 自动累积）
  contentFlags: string[];                  // 玩家在向导设立的旗标（Set a Flag；区别于 scene.flags 的 AI 工作记忆）
  scene: SceneState;                       // 场景序号、flags、在船载具
  journal: JournalEntry[];                 // 结算与叙事事件日志（滚动，上限 500）
  momentum: number;                        // -6 … +10
  seq: number;                             // 单调递增计数器（journal/track id 生成，保证回放确定性）
}

interface CharacterState {
  id: string;
  name: string;
  background: string;                      // M6：玩家自写角色背景（建档可选自由文本，去首尾空白；'' = 未填）
  stats: Record<StatId, number>;           // 建档 1–3（向导 M4 按 {3,2,2,1,1} 分配）；引擎校验整数 0–5
  meters: Record<ConditionMeterId, number>; // health/spirit/supply，0–5
  impacts: MarkedImpact[];                 // 已标记的影响（含来源载具 assetId）
}

interface ProgressTrack {
  title: string;
  rank: ChallengeRank | null;              // troublesome/dangerous/formidable/extreme/epic；legacy 与无 rank 轨为 null
  kind: 'vow' | 'fray' | 'expedition' | 'connection' | 'other';
  ticks: number;                           // 10 格 × 4 tick = 40，封顶
}

interface AssetInstance {                 // M5 扩展（§6.3）
  id: string;                              // 'asset-<n>'（建档）| 'asset-<seq>'（add_asset）
  assetId: string;                         // Datasworn 资产 id
  enabledAbilities: number[];              // 已启用 ability 下标
  optionValues: Record<string, string>;    // 文本/select 选项
  meters: Record<string, number>;          // 资产计量器（integrity/health/shields…，键 = control 键）
  controls: Record<string, boolean>;       // checkbox/card_flip 控制（含 out_of_action/broken 等）
  attachedTo?: string;                     // 挂载到的载具实例 id（module → starship）
}

interface SceneState { index: number; flags: Record<string, JsonValue>; aboardVehicleAssetIds: string[]; }
interface JournalEntry { id: string; kind: 'settlement' | 'note'; sceneIndex: number; note?: string; outcome?: EngineOutcome; }
```

所有状态变更通过**纯函数 reducer**：`(state, event) => state`；事件即工具调用的执行结果，天然构成审计日志与测试回放素材。存档 = 序列化的 CampaignState。id 一律由 `seq` 计数器生成（不用随机），保证同种子回放逐字节一致。事件列表、结算明细与错误码见专题设计文档 `docs/engine-design.md`（M2 起维护）。

### 6.2 骰子与结算（以 Rules-Summary / Primer PDF 为准）

- **RNG**：`Rng = () => number`，默认 `globalThis.crypto`；测试/回放注入 mulberry32 种子。每次掷骰记录全部骰值与出处。
- **动作骰**：`action die d10 + stat（或条件计量器值）+ adds` = action score，**score 上限 10（超出截断）**，下限 0；与 `2 × challenge d10` 比较：
  - `score > 挑战骰较高者` → strong hit；`score > 较低者` → weak hit；否则 miss（平局归挑战骰，score 为 10 时永不命中挑战骰 10）。
  - **match = 双挑战骰点数相同**（Starforged 无 action-die match 概念），作为叙事提示/后续 move 与资产触发器暴露给上层。
  - **负 momentum**：momentum < 0 且其绝对值等于 action die 点数 → action die 取消，score = stat + adds。
  - **burn momentum**：掷出后（看到骰值再决定）以正 momentum 值**替换** action score，随后立即重置为 reset 值；进度投不可 burn。
- **进度投**：`score = 已满格数（ticks ÷ 4 向下取整）`，仅掷 2 × challenge d10 比较；无 action die、无 momentum 交互（不可 burn、负 momentum 不取消）。已清空的 legacy 轨按 10 计（M5）。
- **进度标记量（per rank）**：troublesome = 3 格(12 tick)、dangerous = 2 格(8 tick)、formidable = 1 格(4 tick)、extreme = 2 tick、epic = 1 tick；"mark progress twice" 即按 rank 标两次。
- **momentum**：范围 **-6 … +10**；`momentumMax = 10 − 生效 impacts 数`（battered/cursed 等车辆类仅当该载具在船时计入）；`reset`：0 个 impact = +2、1 个 = +1、≥2 个 = 0；增加 momentum 不得超过 max；burn 后重置为 reset。
- **impacts**：标记后封锁对应 meter 恢复（wounded → health、shaken → spirit、unprepared → supply，取自 Datasworn `prevents_recovery`）；已标记不可重复标记，清除后方可再标；permanent 类清除事件被拒绝。
- **oracle 掷表**：按表的行覆盖面取骰——行覆盖 1–100 的表（含 d100 表与合成的 2d10 几率表）掷**双位 d100**（两枚 d10，十位/个位，10 记 0，00 = 100），记录 `match = 十位 == 个位`（Ask the Oracle 用）；其余表按覆盖面上界 N（= max row.max，对应声明的 1d10/1d20 单骰）掷 1..N，`match` 恒为 false；随后区间二分查找行文本；`{{table:<oracle_id>}}` 嵌入由引擎递归展开（深度上限 + 环检测），`suggestion` 作为附加返回。（bugfix：此前引擎对全部表硬掷 d100，1d10/1d20 表在 roll > N 时抛 `unknown_table`，如 `settlements/name_tags`。）

### 6.3 资产自动化（M5 全量落地）

- **实例化与计量器**：`add_asset` 以 Datasworn 资产定义实例化——首 ability 启用（Rules-Summary p6）；`controls` 中 `condition_meter` 型（integrity/health/shields…）按 `min/value` 初始化进 `meters`，`checkbox`/`card_flip` 型初始化 `controls=false`。嵌套 control（starship integrity → battered/cursed；companion health → out_of_action）以**叶子键平铺寻址**（键在资产内唯一）。`add_asset` 可带 `payWithExperience`（3 XP，Advance 购买）与 `attachTo`（module 挂载到载具实例，校验目标 `attachments.assets` glob）。
- **ability 解锁**：`enable_ability` 依 `requirement` 校验——结构化规则：文本含「fill N boxes on your X legacy track」→ 校验对应 legacy 轨已填格数；其余为叙事前置（如 "Once you Forge a Bond…"），由调用方传 `requirementConfirmed` 断言成立（引擎不校验小说，但审计链留痕）。解锁费用 2 XP（`payWithExperience`）。已启用不可重复启用。
- **enhance_moves**：`listEnhancements(state, index, moveId)` 汇总所有已启用 ability 的 `enhances[]` 命中该 move 的增强项（`*` 通配分类段，如 `starforged/moves/*/face_danger`）；`disables_asset` 控制为真的资产不提供增强。make_move 结算时作为**可选修正项**（`enhancements[]`）返回给调用方：加值类经 `add` 参数落地，重掷/骰后奖励由 AI 依文本经既有工具补齐。
- **资产计量器**：`adjust_asset_meter { assetId, control, delta }` 夹取 [min,max]；starship/support vehicle 的 `battered` 已标记时拒绝提高 integrity（Rules-Summary p5「Until you successfully Repair, you cannot raise the vehicle's integrity」）；`attached_asset_control` 触发经 `attachedTo` 解析挂载载具的计量值。
- **资产 impacts 联动**：`count_as_impact` 资产（Oathbreaker）持有期间计入 momentum max/reset；`is_impact: true` 的 checkbox（battered/cursed）标记/清除即 `mark_impact`/`clear_impact`（带 assetId），不另设第二状态源；`disables_asset` 控制为真时该资产计量器不可作触发来源、不提供增强（数值调整仍允许，如治疗同伴）。`discard_asset` 移除实例并连带清除其名下 impacts。
- **资产内嵌 moves**：data 层将 `abilities[].moves`（12 个，如 Raise Shields/Seek Safe Haven）注册进 `byId` 与 move 目录「Assets」分类，走 make_move 同一结算管线；触发中的 `asset_control`/`attached_asset_control` 选项由调用方传 `asset_id`（实例 id）结算。
- **asset_control 触发（M4 两 move 的结构化拒绝解除）**：Companion Takes a Hit / Withstand Damage 经 `asset_id` 选定实例，以其计量值为 baseValue 发起动作骰；仅一个匹配实例时自动选定（payload `selection` 注明）。

**legacy 与经验（M5）**：`experience` 入 CampaignState；`adjust_legacy` 正向刻度跨过格边界时自动按 Earn Experience 结算经验（每新填格 2 XP；已清空轨 1 XP，Rules-Summary p4），第 10 格填满即清空（ticks 归零、`cleared=true` 十字标记）；负向刻度（mark_bond_decrease）直接扣减、floor 0、无 XP 交互。legacy 奖励表 `legacyRewardTicks(rank, levelsDown)`：troublesome=1 tick、dangerous=2、formidable=1 box、extreme=2 boxes、epic=3 boxes（降一档取低档值，低于 troublesome 为 0）。

### 6.4 导出 API

```ts
createNewCampaign(input: NewCampaignInput): CampaignState
// NewCampaignInput（M4 扩展）：characterName、stats（建档 {3,2,2,1,1} 分配）、
// truths?（TruthKey → 选项序号）、assets?（初始资产 id 列表，首 ability 启用）、
// backgroundVow?（{ title, rank }，创建 kind='vow' 的初始进度轨）、
// background?（M6：玩家自写角色背景，可选自由文本，引擎只校验字符串并去首尾空白；上限由向导把守 2000 字符）、
// contentFlags?（玩家旗标，Set a Flag：去空白、去空串、去重后入库）
reduce(state: CampaignState, event: EngineEvent, ctx: { index: StarforgedIndex; rng: Rng }): ReduceResult
// ReduceResult = { ok: true; state; outcome: EngineOutcome; log: AuditEntry } | { ok: false; state(不变); error: EngineError; log }
resolveActionRoll → computeActionRoll(input: { stat?; meter?; add?; momentumBurn? }, dice: ActionDice, ctx: { baseValue; momentum }): ActionResult
// M4：action_roll 的 stat/meter 皆可缺省（最多其一），缺省时 baseValue=0（如 Develop Your Relationship 的 +rank 投）
// M5：action_roll 另接受 assetMeter { assetId, control }（与 stat/meter 互斥），baseValue = 资产计量值
rollOracle(tableId: string, ctx): OracleResult
momentumMax(state: CampaignState): number
momentumReset(state: CampaignState): number
// M5 新增
migrateCampaignState(raw: CampaignState): CampaignState   // 迁移链 v1→v2→v3→v4（experience/controls → contentFlags → character.background 默认 ''）
listEnhancements(state, index, moveId): Enhancement[]     // 已启用 ability 对 move 的增强项（§6.3）
legacyRewardTicks(rank: ChallengeRank, levelsDown?: number): number  // legacy 奖励刻度表
ADD_ASSET_COST = 3 / ENABLE_ABILITY_COST = 2               // Advance 经验价目（§8.7 面板与引擎共用）
```

`EngineEvent` 全集（工具 JSON schema 与之对应）：`action_roll / progress_roll / burn_momentum / adjust_momentum / adjust_meter / mark_impact / clear_impact / add_track / mark_progress / adjust_legacy / set_flag / add_journal_entry / set_aboard_vehicle / end_scene`；M5 新增：`add_asset { assetId, payWithExperience?, attachTo? }`、`discard_asset { assetId }`、`enable_ability { assetId, abilityIndex, payWithExperience?, requirementConfirmed? }`、`adjust_asset_meter { assetId, control, delta }`、`set_asset_control { assetId, control, value }`、`remove_track { trackId }`、`update_track { trackId, title?, rank?, ticks? }`；`adjust_legacy` 支持负刻度并自动结算经验；`roll_oracle`、`make_move` 由工具层调用。M4：`progress_roll` 的 `trackId` 亦接受 legacy 轨 id（`*_legacy`，score=满格数，已清空按 10）——供 Overcome Destruction / Continue a Legacy / Seek Safe Haven 等 special_track move 使用。详见 `docs/engine-design.md`。

---

## 7. AI 层设计（packages/ai）

> 专题设计见 `docs/ai-design.md`（协议细节、错误诊断、提示词构成、测试矩阵）与 `docs/llm-interaction.md`（逐交互说明：发送内容与期望返回），变更同步维护。

### 7.1 OpenAI 兼容客户端

- `Chat Completions`：`baseUrl + /chat/completions`，SSE 流式解析（`data:` 帧、`[DONE]`、tool_calls 增量聚合）；`baseUrl/key/model` 可配置（M4 起无内置预设，只保留 URL 归一化辅助函数）。
- **连接测试**：发一个强制 function-calling 的探测请求，校验模型能返回 tool_calls；失败给出可读诊断（不支持 FC / 401 / 网络错误 / CORS）。
- Key 仅存 localStorage，绝不入库存档/日志/上报。

### 7.2 GM agent 循环

```
用户输入 → 组装 messages（system + 前情提要[历史被截断时] + 滚动历史 + 本回合用户输入）
→ 请求流式补全 →
  ├─ 文本增量 → 叙事流渲染
  └─ tool_calls → 引擎执行 → 结果作为 tool role 消息回传 → 继续补全
→ 工具调用次数 ≥ 预算（默认 12/回合）→ 强制收尾（不再提供工具，要求总结）
```

- **系统提示词**：GM 行为规范 + 压缩状态快照（角色/meters/momentum/活跃轨/impacts/最近场景摘要 + 玩家旗标 + 角色背景 BACKGROUND 行，非空时输出 + 设定真相 TRUTHS 段，truths 非空时逐行列出各条 `- <truth 名>: <选项摘要>`，世界观正典每回合常驻）+ moves/oracles 目录树（仅 id+名称，几 KB）。玩家旗标（Set a Flag）是玩家的职责与权限：GM 规范明确要求把旗标题材视为边界——回避或以"擦过不细绘"方式处理（Reframe/Refocus/Replace/Redirect/Reshape，见 Change Your Fate），且**绝不自行新增/修改/删除旗标**。GM 规范还要求**标记进度纪律**：结局文本给"标记进度"时必须立即以 `mark_progress` 落地（"标记两次"→ `marks: 2`，级别自动换算刻度），里程碑式进展先经 `reach_a_milestone` / `develop_your_relationship` 再标进度——防止进度轨长期停留在 0（详见 `docs/ai-design.md` §6）。
- **叙述风格（玩家可选预设，支持自定义）**：GM 规范"文风"段按玩家在设置中选择的风格预设注入（runTurn `style` 参数 → `buildSystemPrompt`），共 5 档，默认 `classic` 与旧版文本逐字节一致——`classic` 标准（2–4 段紧凑叙述）、`concise` 简练（1–2 短段，先写发生了什么与代价）、`literary` 沉浸（3–5 段，感官细节与氛围、角色内心）、`humorous` 诙谐（轻松打趣，但沉重时刻不打趣）、`hardboiled` 冷硬（短促句、干脆、不煽情）；全部预设保留第二人称叙述、NPC 动机与立场、回合结尾给出悬念或明确处境。另有 `custom` 自定义档：设置下拉选「自定义」后出现文本框（≤600 字符），玩家自由描述笔调，原文经净化（首尾去空白、内部空白折叠为单行、超长截断至 600 字符）后作为文风句注入——替换的只是风格预设句，GM 规范其余固定纪律（工具权威、回合收尾悬念、摘要/选项块尾注）不受影响；空白文本回退 classic。自定义文本持久化于 localStorage（`starwright.settings.v1` 的 `customStyle` 字段），未知风格值回退 classic。见 `docs/ai-design.md` §6/§9 与 `docs/llm-interaction.md` §1.1。
- **CYOA 选项建议（可选）**：玩家在设置中开启后，系统提示词追加 "Player choices (CYOA)" 段——每回合收尾叙述以 `<choices>…</choices>` 块给出恰好 5 个具体可执行的行动选项，每行行尾以方括号标记对应 move（如 `[Face Danger]`）或纯剧情（`[剧情]`/`[story]`，待决选项以来源 move 标记）；块是 assistant 文本的一部分（不改工具协议/历史结构），web 端剥离渲染为按钮（标记渲染为徽标、点选发送净文本），点选即作为玩家输入，也可自由输入；关闭时提示词与旧版一致。见 `docs/llm-interaction.md` §1.1/§1.4 与 `docs/ai-design.md` §6/§9。
- **回合摘要与历史压缩**：GM 每回合收尾叙述后（`<choices>` 块之前，若启用）以 `<summary>…</summary>` 块给出恰好一句的本回合概括（≤30 字/词，关键事件+结局方向）；块是 assistant 文本的一部分（协议同 CYOA 块），web 端剥离后以小字摘要在该消息下方常驻展示。历史上限（`maxHistoryMessages`，玩家可设置，默认 40 条消息）截出的旧消息，在下一回合组装 messages 时以其中各 assistant 文本提取的 `<summary>` 拼成一条**回合内临时** `STORY SO FAR` system 消息（前情提要，最多 20 行）注入——历史本身不丢、不回滚，被截回合的事实记忆以摘要延续；截出区无 `<summary>`（旧存档或模型漏写）则跳过，整段无摘要则不注入（与旧版行为一致）。见 `docs/ai-design.md` §6/§7/§9 与 `docs/llm-interaction.md` §1.1/§1.4。
- **上下文控制**：move/oracle 全文按需用工具获取（`get_move_detail` / `get_oracle_detail`）；日志滚动摘要；每回合重建快照而非累积；历史滚动窗口 + 前情提要（见上）。
- **错误自纠**：工具执行失败返回结构化错误（`{ error: code, message, hint }`）作为 tool 结果回传，模型可自行修正参数。
- **逐交互审计**：`runTurn` 记录每轮请求的 messages/tools 快照与响应（叙事/推理/工具调用/finish_reason/诊断）为 `TurnInteraction[]`，随 `TurnResult.interactions` 返回；推理模型返回的 `reasoning_content`（或 `reasoning`）聚合为推理文本并经 `onReasoningDelta` 实时上抛。UI「GM 活动」面板可逐轮查看（仅内存，不入存档）。详见 `docs/llm-interaction.md` §1.6。
- **token 用量**：累计 prompt/completion tokens 并在 UI 显示。

### 7.3 工具清单（引擎执行，全部权威）

| 工具 | 作用 |
|---|---|
| `make_move(move_id, roll_selection, oracle_id?)` | 结算 move：动作骰/进度投/no-roll/special_track；trigger 校验选择（M4）、内嵌 oracle 自动掷（M4）；返回结局文本与数值变化 |
| `roll_oracle(table_id)` | 掷 oracle 表（按表 dice：d100 表掷双位 d100，1d10/1d20 表掷单骰 1..N），返回行文本 |
| `get_move_detail(move_id)` / `get_oracle_detail(table_id)` | 按需获取全文 |
| `adjust_meter / adjust_momentum / burn_momentum` | meters 与 momentum（与引擎事件同名） |
| `add_track / mark_progress / swear_vow / update_track` | 进度轨创建、刻度与修订（update_track：M5，重掷箱清格/升档等 move 文本落地） |
| `fulfill_vow / forsake_vow` | 誓言生命周期（M5）：进度投+legacy 奖励+移除轨 / 移除轨 |
| `forge_bond / mark_bond_decrease` | 纽带（M5）：进度投+bonds_legacy 奖励+移除轨 / 纽带减损 |
| `adjust_legacy` | legacy 轨刻度（M5 登记为工具；正向自动结算经验） |
| `mark_impact / clear_impact` | 影响标记 |
| `add_asset / discard_asset / enable_ability / adjust_asset_meter / set_asset_control` | 资产（M5）：实例化（可 3 XP 购买/挂载）、弃置、解锁 ability（2 XP+requirement）、资产计量器、非 impact 控制 |
| `end_scene / add_journal_entry / set_flag` | 场景与日志 |

工具 JSON schema 与引擎事件一一对应；新增工具必须先在本表登记。模型端非标准参数格式（GLM/Qwen 系的 `<arg_key>/<arg_value>` 标签或重复键 JSON）由 ai 层在执行前归一化为标准键值（`packages/ai/src/args.ts`），错误仍结构化回传自纠。
**M3 实现子集**：make_move（最小版）、roll_oracle、get_move_detail、get_oracle_detail、adjust_meter、adjust_momentum、burn_momentum、mark_impact、clear_impact、add_track、swear_vow、mark_progress、set_flag、add_journal_entry、end_scene。
**M4**：工具集不变，make_move 升级为全量接入——12 类 56 个 move 全部可经其调用：trigger 选择校验（不合法回 `invalid_roll_selection` 并列出合法项）、`highest/lowest` 触发按当前状态自动选值、`custom` 触发映射为 `add`（如 Develop Your Relationship 的 +rank）、no_roll 文本中的 `{{table:...}}` 展开、move.oracles 内嵌表自动掷（未被文本引用且仅剩 1 张时自动掷，多张经 `oracle_id` 参数选择，如 Ask the Oracle 的五档几率）、special_track 经 legacy 轨进度投结算（Overcome Destruction = bonds_legacy；Continue a Legacy = 三轨各一掷）。
**M5**：make_move 再升级——`asset_control`/`attached_asset_control` 触发经 `asset_id`（实例 id）结算（唯一匹配自动选定；`asset_control_no_asset`/`asset_control_ambiguous` 自纠），结算结果附 `enhancements[]`（已启用 ability 的增强项）；资产内嵌 12 move 入目录可调用（Seek Safe Haven = discoveries_legacy special_track）。工具集增至 26 个：add_asset、discard_asset、enable_ability、adjust_asset_meter、set_asset_control、adjust_legacy、update_track、fulfill_vow、forsake_vow、forge_bond、mark_bond_decrease。Advance（3 XP 购新资产 / 2 XP 升级）由 add_asset/enable_ability 的 `pay_with_experience` 承载；Earn Experience 由 adjust_legacy 自动累积。详见 `docs/ai-design.md` §1/§5。

---

## 8. UI 设计（apps/web）

### 8.1 布局

- 左栏：角色/状态/进度轨/资产面板（meters、momentum 可 burn 按钮、誓言轨、legacy 轨、资产卡）；「经验」行旁常驻「进阶」按钮，展开进阶面板（§8.7）。调试模式开启时（§8.3），面板标题旁出现「编辑」开关，展开后可直接修改玩家信息：名字、五维 stats（0–5 整数）、health/spirit/supply（0–5）、momentum（−6…+10）、experience（≥0 整数）；修改即改即存（经 campaign store 的 `debugPatch` 直接替换状态并落库，绕过引擎 reducer——玩家调试专用，AI 工具路径与 INV-1 的 AI 边界不受影响）。
- 中栏：叙事流（流式 markdown）；机制事件渲染为**结算卡片**（骰值、结局、得分拆分——行动骰/属性或计量器来源/加值逐项列出，见 ai-design.md §9、规则引用），内嵌在叙事中。GM 收尾叙述含 CYOA 选项块时（设置开启），正文剥离后渲染 5 个选项按钮（行尾方括号 Move 标记渲染为紧随文本的小字徽标——move 名经当前数据语言包解析为本地化名称、剧情标记按 UI 语言本地化，hover 徽标以 `.ds-tip` 悬浮卡显示该 move 的规则定义，点选发送剥离标记后的净文本），点选即发送为玩家回复，输入框自由输入不受影响。GM 回复下方有默认隐藏的「LLM 交互」胶囊开关（仅本回合有数据）：点击弹出 pop-up 窗口，按轮倒序展示每轮的模型推理、请求 JSON（messages + tools）与回复（详见 llm-interaction.md §1.6）；回合进行中亦可点开实时查看，遮罩点击 / Esc / 关闭按钮均可关闭。
- 富文本链接悬停：游戏数据文本中的 `[label](id:…)` 链接（点状下划线 + `cursor: help`）悬停 tooltip 显示目标节点**定义**而非原始 id——经 `index.byId` 解析为「节点名称 + 摘要」，以自定义 CSS tooltip（`.ds-tip`，非原生 `title`）按 **markdown 渲染**：按节点类型取 `text`/`summary`/首 ability 等富文本字段，经 `dataswornToMarkdown` 转换（`__bold__` 保留为加粗、`[label](id:…)` 还原为纯 label、`{{table:…}}` 丢弃），保留换行与 `*` 列表结构并截断至 ~400 字符，再经共享的 `Markdown` 组件渲染（列表、加粗、段落均有样式，非纯文本堆叠）。索引未命中或未加载时回退为原生 `title` 显示原始 id。
- 右栏：GM 活动面板（工具调用与掷骰日志，逐条可展开审计：入参、骰值、状态 diff）。「LLM 交互」审计已移至中栏叙事流、挂在本回合 GM 回复下方（见上）。
- **左栏宽度可调**：左栏与中栏之间有拖拽分隔条（`role="separator"`，宽 6px，悬停/拖拽高亮）——按住横向拖动即可在 200–560px 范围内调整左栏宽度，双击恢复默认 280px；也支持键盘（聚焦后 ←/→ ±16px，Home/End 取最小/最大）。宽度存于设置的 `leftPanelWidth`（localStorage 持久化，见 §8.3），经 CSS 变量 `--left-width` 注入 `.columns` 的 `grid-template-columns`，右栏（开启时）固定 320px 不变。
- **悬停 tooltip 不被裁剪**：`.ds-tip`（富文本链接定义）与 `.term-tip`（规则术语表）均改为经共享组件 `FloatingTip`（`apps/web/src/shared/FloatingTip.tsx`）渲染——触发元素悬停/聚焦时以 React portal 挂到 `document.body`，`position: fixed` 定位（按触发框计算并夹取到视口内，顶部放不下自动翻转到下方，滚动/窗口尺寸变化时跟随重算）。原因：两栏滚动容器 `overflow-y: auto` 会裁剪内部绝对定位的 tooltip（左栏窄、tooltip 常被右缘切断，见 §8.5 术语表）；portal + fixed 使 tooltip 脱离裁剪上下文。`.ds-tip` 为可交互模式（可移入 tooltip 内滚动查看，关闭带短延迟桥接指针移动），`.term-tip` 为纯展示（`pointer-events: none`）。
- 底部输入框：玩家自由文字；Enter 发送。

### 8.2 新档向导（M4）

依据 Rules-Summary p6「When you create your character, you pick three assets. You also start your campaign with a STARSHIP command vehicle.」与 Primer p8（stats 各 1–3、背景誓约）：

向导页同样渲染顶栏（标题 + 设置按钮）——玩家在下列任何一步都能打开设置页（配置 AI、切换语言等），面板展开于向导内容之上方；开始新战役时面板 UI 态照旧关闭（见 §8.3）。

1. **Truths**：14 类各选一项（单选项展示 summary/description/quest starter 预览，默认预选第一项）。步骤顶部提供 🎲「随机选择真相」按钮：按下后为 14 类真相各均匀随机选定一项（客户端 `Math.random`，等概率抽取，与子表的 1d100 min/max 加权掷骰语义无关）；不清除已掷的子表结果，未选选项的子表结果本就不进入开场简报（见下）。玩家仍可逐类改选覆盖。description 中的内嵌子表占位符 `{{table:starforged/truths/<key>/<option>}}` 不以原文展示，而是渲染为行内选择器：下拉列出子表各行 + 🎲 随机按钮；随机按 min/max 区间加权（1d100 语义，复用 `findRowByRoll`），不是均匀抽样。玩家的选/掷结果存入向导临时状态 `truthDetails`（合成子表 id → 行文本），仅对应所选选项的结果进入开场简报。选定 truths 经 `NewCampaignInput.truths` 入 `CampaignState.truths`，并以 `TRUTHS` 段（`- <truth 名>: <选项摘要>`）常驻每回合系统提示词快照——世界观正典不随开场消息被截出历史而丢失；子表结果不持久化、不入快照。
2. **角色**：名字（必填）+ 角色背景（可选自由文本）+ 属性分配——五项从 {3,2,2,1,1} 取值各用一次（引擎校验 1–3 且多重集相等）；可选背景誓约（title + rank，落为 kind='vow' 的初始进度轨）。角色背景为玩家自写的一段设定（who they are / where they come from / what drives them），文本域 ≤ 2000 字符、入库前去首尾空白，经 `NewCampaignInput.background` 入 `CharacterState.background`；非空时进入 GM 系统提示词快照（BACKGROUND 行，空白折叠为单行）与开场简报，作为 GM 必须遵循的设定正典。背景不设独立工具，AI 无权改动。
3. **旗标（Set a Flag，可选）**：玩家在启程前标出不希望出现、不希望细致描绘、或需谨慎处理的情境/题材（规则书 `starforged/moves/session/set_a_flag`，属玩家职责）。自由文本逐条添加（去空白、去重，上限 10 条、每条 120 字符），可为空；结果经 `NewCampaignInput.contentFlags` 入 `CampaignState.contentFlags`，进入系统提示词快照与开场简报，GM 据此回避或淡化处理。旗标不经 AI 工具暴露（玩家专有，AI 无权改动）；对局中途调整列入后续工作。
4. **初始资产**：Starship（command vehicle）固定入列；另自目录任选 3 个资产（按类别分组浏览+搜索；首 ability 启用）；Starship 本身不可再选（向导列表隐藏 + 校验拒绝，防止重复实例）。「按 Truth/背景推荐」实现为类别快捷过滤（companion/path/module…），不做杜撰映射。
5. **开场场景**：完成即建库（Dexie 落库），并以所选 truths 的 summary + 背景誓约 + 旗标拼装开场输入自动发送给 GM，由 AI 开启场景 1。truth 行在玩家已定子表结果时追加该结果（`- <truth 名>: <选项摘要> (<子表行文本>)`），让 GM 掌握设定细节。quest starter 仅为向导内玩家规划誓约的灵感素材（选项预览可见），不进入发给 GM 的开场简报。

### 8.3 设置页

自定义 baseUrl/key/model（任意 OpenAI 兼容 endpoint，无预设下拉）+ 连接测试；叙事语言 zh/en；叙述风格预设 classic/concise/literary/humorous/hardboiled/custom（默认 classic，选 custom 时出现 ≤600 字符的自定义文风文本框）；每回合工具预算；CYOA 选项建议开关（默认开启，关闭后系统提示词不再注入选项段）；调试模式开关（默认关闭，localStorage 持久化，见 §8.1 左栏编辑入口）；数据管理（导出/导入/重置）。

**入口常驻**：对局顶栏与新档向导顶栏均有设置按钮（未配置 AI 时以高亮「配置 AI」提示）；设置菜单在包括新战役设定（Truths → 角色 → 资产 → 启程）在内的任何时刻都可打开。

### 8.4 存档（M4 落地）

- Dexie（IndexedDB）：战役状态 + 聊天流（entries/history/工具日志/usage）自动保存（变更后防抖 ~500ms，M4 起聊天流一并落库）；启动时加载，M5 起经 `migrateCampaignState` 做版本迁移链（v1→v2 补默认字段），迁移失败才弃用并向导重开。
- 设置页数据管理（M6 落地）：删除存档（回到向导重开）；导出/导入 JSON 存档文件。导出文件格式（`apps/web/src/persistence/saveFile.ts`，纯函数可测）：

```ts
interface SaveFile {
  kind: 'starwright-save';     // 导入识别标记，不符即拒绝（兼容旧版 'starforge-save'）
  fileVersion: 1;              // 导出文件自身版本
  exportedAt: string;          // ISO 时间戳
  campaign: CampaignState;     // 原样导出（含 state.version），导入时走 migrateCampaignState 迁移链
  chat: { entries; history; toolLog; usage } | null;  // 聊天流快照（可为空）
}
```

  导入流程：解析 → 校验 `kind`（接受 `starwright-save` 与旧版 `starforge-save`）/结构 → `migrateCampaignState` 迁移 → 版本复核 → 确认覆盖后替换内存态并落库；任何一步失败给出可读错误且不影响现有存档。API Key 永不入导出文件。

### 8.5 i18n

- react-i18next，`zh/en` 文案包；UI 文案全量覆盖两语言；`uiLanguage` 设置（设置页 + localStorage 持久化，M6）切换并即时生效。
- **游戏数据预翻译（zh）**：`data/starforged.json`（英文原文，Datasworn 0.0.10，不改动）之外提供结构完全一致的 `data/starforged.zh.json`——仅翻译展示字段（`title`/`name`/`label`/`summary`/`description`/`text`/`text2`/`quest_starter`/`control`/`requirement`/`your_character`/`canonical_name`/`option`），所有标识符字段（`_id`/`id`/`type`/`dice`/枚举值等）与 markdown `(id:…)` 链接目标保持原样。
- 数据语言跟随 `uiLanguage`：zh 加载 `starforged.zh.json`（缺失字段回退英文原文），en 加载原文；启动时按当前语言 fetch，切换语言后重新拉取并重建索引（存档按 id 引用数据，不受影响；已存文本快照不做迁移，新旧语言混排可接受）。
- 生成管线（仓库内一次性工具，Python）：`scripts/i18n_extract.py` 抽取去重字符串（含字段/上下文）→ 人工/AI 批量翻译 → `scripts/i18n_inject.py` 回填生成 zh 文件并做键位/链接一致性校验。zh 文件额外内置"询问神谕"五张概率表（是/否）的本地化版本；数据包索引器对已存在于数据中的表跳过英文合成。
- 结算卡片与详情处保留"AI 翻译"按钮作兜底（数据语言 === UI 语言时隐藏）：仅当数据缺失翻译（回退英文）时仍可临时调用 LLM 翻译（M6 行为，缓存于 localStorage）。
- **规则术语表与悬停说明**：UI 中裸露的规则术语 id（五维 stats `edge/heart/iron/shadow/wits`、状态计量器 `health/spirit/supply`、影响 `wounded/shaken/…`、legacy 三轨、track kind、roll_type）不再直接显示——经共享组件 `RuleTerm`（`apps/web/src/shared/RuleTerm.tsx`）渲染为本地化标签：词条存于文案包 `term.*` 段（label + desc，zh 译文取自官方翻译数据 `zh_strings.json` 同源词条）；悬停术语时于其上方显示悬浮 tooltip（`.term-tip`，经 `FloatingTip` portal 渲染，见 §8.1），内容为「英文原词 + 规则描述」，帮助 zh 玩家对照原文术语。词条未收录或翻译缺失时回退为原始 id（不附 tooltip）。纯字符串插值场景（结算卡片 delta 行、向导回顾行等）经 `ruleTermLabel(t, kind, id)` 取本地化标签，不附悬停说明。
- AI 叙事语言独立设置（提示词注入"以 XX 语言叙事"）。

### 8.6 构建与部署

- Vite 静态目录：`index.html` + 带 hash 的分包 JS/CSS + `starforged.json` / `starforged.zh.json` 独立资源文件（启动按 UI 语言 fetch 其一，zh 缺失回退 en）。
- 托管：**GitHub Pages（当前生产）** / Netlify / Cloudflare Pages（备选）；页面含 CC-BY 4.0 署名（关于页 + README attribution 块）。
- **GitHub Pages 配置**：
  - 仓库 `foodfix/starwright`，站点地址 `https://foodfix.github.io/starwright/`（项目页为子路径）。
  - `apps/web/vite.config.ts` 固定 `base: '/starwright/'`（本地 dev 与构建一致走 `/starwright/` 前缀，dev 访问 `http://localhost:5173/starwright/`）；应用内所有资源引用必须经 `import.meta.env.BASE_URL` 拼接（数据加载已如此，见 `App.tsx`），禁止裸 `/xxx` 绝对路径 fetch。
  - 部署走 GitHub Actions：`.github/workflows/deploy.yml`（push 到 `main` 或手动触发）→ pnpm 构建 → 上传 `apps/web/dist` → `actions/deploy-pages`。仓库 Settings → Pages → Source 需选 **GitHub Actions**（一次性手动设置，无 CLI/Token 时无法代配）。
  - 部署前本地验证：`pnpm build`（构建本身即 typecheck 入口）+ `pnpm --filter @starwright/web preview` 检查子路径下资源可加载。
  - **itch.io 页面**：上传包 `starwright-itch.zip` 用 `pnpm --filter @starwright/web exec vite build --base=./` 生成（相对路径才能在 itch iframe 内运行）；封面源文件 `itch/cover.svg`，经 `rsvg-convert -w 630 -h 500 itch/cover.svg -o itch/cover.png` 出 630×500 PNG（无 CJK 字形，图中语言用 "EN / ZH" 表示）。
- 文档说明：HTTPS 站点下本地 Ollama 需配置 `OLLAMA_ORIGINS`；`baseUrl` 可指向未来自建代理。
- **安全边界**：Key 只在浏览器内存/localStorage；无任何遥测。

### 8.7 进阶面板（Advance，M6 落地）

经验消费（Advance move）是纯机械交易（价目固定：新资产 3 XP、解锁 ability 2 XP），走对话容易出错（GM 转述 assetId、幻觉资产、多余 token）；而前提是否在叙事中达成是叙事判断，不属于面板。因此采用**混合形态**：机械购买由面板直调引擎，叙事前提由玩家对照原文确认（重大前提玩家应先与 GM 在对话中确认）。

- **入口与形态**：左栏「经验」行旁常驻「进阶」按钮（玩家功能，不属 debug），点击展开面板（再次点击收起）。面板两区：**购买新资产**（目录按类别分组 + 搜索，交互复用向导资产步；已拥有资产从列表排除）与**升级已拥有资产**（每个实例列出未启用的 ability 1/2 及其规则文本）。
- **权威路径**：购买经 `useCampaign.executeEvent`——`add_asset { assetId, payWithExperience: true }`（3 XP）与 `enable_ability { assetId, abilityIndex, payWithExperience: true }`（2 XP）——与 GM 工具走同一条 engine reducer，不另开写状态通道。价目常量 `ADD_ASSET_COST`/`ENABLE_ABILITY_COST` 由 engine 导出，面板显示与引擎扣费同源。
- **预检禁用**：经验不足、legacy 格数缺口时按钮禁用并显示原因（缺口数值），不制造必然失败的点击；引擎错误（`insufficient_experience` 等）仍原样回显兜底。
- **前提纪律**：deed 类资产的 legacy 格数前提（`legacyRequirement`）引擎自动校验，面板预检只读快照；叙事前提（`requirement` 文本）面板展示原文，玩家勾选「前提已在叙事中达成（与 GM 确认）」后方可提交（`enable_ability` 引擎硬校验 `requirementConfirmed`；`add_asset` 引擎不校验，面板同样要求勾选，且叙事馈赠资产不走面板——无 pay_with_experience 的 `add_asset` 仍由 GM 在对话中执行）。
- **GM 感知**：快照每回合重建，XP 与资产变化自动进入下一回合快照，GM 无需聊天流也能衔接叙事；购买成功/失败经聊天流追加 info 条目供玩家审计（仅 UI 展示层，不入 history——模型一律以快照为准，避免双写）。
- **i18n 与测试**：文案段 `advance.*`（zh/en 全量）；可购性/前提视图模型抽为纯函数模块（`features/advance/advance.ts`）单测（XP 不足、legacy 缺口、叙事前提勾选门控、已拥有排除），引擎扣费与 requirement 校验行为已由 engine/ai 单测覆盖，不重复。

---

## 9. 核心流程时序（一个回合）

```
玩家输入
 → web 调 ai.runTurn(campaignSnapshot, messages)
 → LLM 流式返回叙事 + tool_calls
 → web 调 engine.reduce(state, event) 执行每个工具调用
    ├─ 成功：结算卡片入叙事流；tool 结果回传 LLM
    └─ 失败：错误结构回传 LLM 自纠
 → 回合结束：状态落库（Dexie）、GM 面板更新、journal 滚动
```

---

## 10. 测试与验证

- **单测（Vitest）**：
  - data：抽查 moves/oracles/assets/truths 节点解析（face_danger、core oracle、starship 资产、cataclysm truth）；
  - engine：动作骰边界（7–10 vs 挑战骰）、match 判定、进度投公式、momentum 上限/重置/burn、impacts 封锁恢复、oracle 二分查找与嵌表展开、资产 enhance_moves 触发；
  - property 测试：10k 随机骰断言结局分布与边界正确（种子固定可复现）。
- **集成脚本**：伪模型（固定工具调用序列）跑通「建角 → 立誓 → Face Danger → 战斗 → 恢复 → End Session」全程，断言状态。
- **手工双通道**：DeepSeek（云）与 Ollama（本地 qwen 系）各试玩 30 分钟，对照 `pdfs/Ironsworn-Starforged-Rules-Summary.pdf` 抽查结算。
- **CI**：lint + typecheck + test 全绿。

---

## 11. 里程碑与验收标准

| 里程碑 | 内容 | 验收 |
|---|---|---|
| M1 骨架与数据 | pnpm workspace + Vite/TS/ESLint/Prettier/Vitest + CI；packages/data（zod schema、加载、索引） | CI 绿；data 单测抽查通过；`pnpm dev` 显示骨架页 |
| M2 引擎核心 | CampaignState、动作骰/进度投、momentum、meters、impacts、oracle 掷表与 `{{table}}` 展开 | property 测试 10k 骰通过；纯函数可脱离 UI 跑通结算（种子回放） |
| M3 AI GM 循环 | OpenAI 兼容客户端 + streaming + 工具协议；系统提示词与快照；最小聊天 UI + 结算卡片 + 工具日志 | 连接测试通过；真实模型完成一次含 move 结算的对话 |
| M4 新档向导与全量动作 | Truths→建角→初始资产；12 类 move 全接入；oracles 全目录；Dexie 存档 | 向导建角入库（刷新不丢）；全部 move/oracle 可经工具调用（2 个 asset_control move 返回 M5 结构化拒绝） |
| M5 资产全自动化与 legacy | enhance_moves/资产 meter/requirement；legacy 轨与 legacy moves；Begin/End a Session | 资产条件触发单测通过；legacy 进度可兑现经验 |
| M6 发布打磨 | i18n zh/en、导出/导入、README/LICENSE（MIT + CC-BY 署名节）、token 计量、失败模式提示 | 静态站点公开可玩；双语覆盖；导出导入回环验证 |

### 11.1 验收文档

每个里程碑需要一份**轻量验收文档** `docs/milestones/Mx-acceptance.md`，作为里程碑合入与进入下一阶段的依据：

- **开工前**：从 §11 总表展开为该里程碑的验收清单（交付物、验收标准、验证命令、手工检查项），随实现内容细化。
- **完成时**：逐项填写验证记录——命令输出摘要（lint/typecheck/test）、property 测试结果、集成脚本断言结果、手工检查结论（含双通道试玩记录，M3 起适用）、日期。
- 全部条目通过即视为里程碑验收完成；未通过项必须列出原因与后续计划，不得带病进入下一里程碑。

---

## 12. 风险与对策

- **模型工具调用质量参差** → 连接测试强制校验 function calling；不支持 function calling 的 endpoint 给出可读诊断；引擎对非法调用返回可读错误供模型自纠。
- **上下文膨胀** → 只放状态快照 + 目录树；move/oracle 全文按需工具获取；日志滚动摘要。
- **规则漂移** → 引擎唯一权威（INV-1/2）；结算卡片全程可见；对照 Rules-Summary PDF 抽查。
- **数据许可** → 内容 CC-BY 4.0 需署名，README 固定 attribution 块；代码 MIT；不复制 PDF 文本进代码库（INV-3）。

---

## 13. 许可与署名

- 代码：MIT（`LICENSE`）。
- 游戏内容（Datasworn 数据与派生展示）：CC-BY 4.0，需标注：*Ironsworn: Starforged © Shawn Tomkin，数据来自 Datasworn 项目，CC-BY 4.0*。
- **商标/官方性**：产品名独立于官方（Starwright），仅以 *"An AI Game Master for Ironsworn: Starforged"* 等描述性短语指明兼容的游戏；所有对外文案必须含非官方免责声明——*unofficial, not affiliated with or endorsed by Shawn Tomkin or Tomkin Press*（Tomkin Press 许可条款：不得声明或暗示作品为官方 Tomkin Press / Ironsworn 产品；不得使用官方美术/图标/装帧设计）。项目当前免费开源，走非商业 CC 路径；若未来商业化，需转向 Starforged Reference Guide 的 CC-BY 路径并复核许可。
- README 固定 attribution 块；关于页同款文案。

---

## 14. 开放问题（不阻塞实施）

- ~~项目最终名称~~（已解决，2026-09-19 定名 **Starwright**，理由与影响范围见文首更名记录；对外统一副标题 *An AI Game Master for Ironsworn: Starforged*）。
- 美术风格/图标来源（M6 前定；可用 CC0 资源包）。
- v2：轻量 LLM 代理（Node/Cloudflare Worker，服务端藏 Key + 限流）、在线联机、Anthropic 原生协议、Tauri 桌面打包。

---

## 15. 文档维护规则

1. 任何实现先改本文档（或在其下新增专题设计文档），再写代码。
2. 工具清单（§7.3）与导出 API（§5.2/§6.4）变更必须同步本表；引擎事件/结算明细/错误码以 `docs/engine-design.md` 为准，二者变更同步维护。
3. 里程碑验收标准（§11）是 PR 合入的判断依据；每个里程碑的验收清单与验证记录写入 `docs/milestones/Mx-acceptance.md`（见 §11.1）。

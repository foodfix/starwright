# 引擎专题设计（packages/engine）

> 依据 `docs/DEVELOPMENT.md` §6 展开，自 M2 起维护。规则原文以 `pdfs/Ironsworn-Starforged-Rules-Summary.pdf` 与 `Rules-Setting-Primer.pdf` 为准；本文与二者冲突时先修文档再改代码。

## 1. 规则事实清单（已对照 PDF 勘误）

| 规则 | 结论 | 出处 |
|---|---|---|
| momentum 范围 | **-6 … +10**（非 0–10） | Rules-Summary p2 |
| action score 上限 | **10**，超出截断；下限 0（stat+adds 可为负时） | Primer p12「never greater than 10」 |
| 命中判定 | score **大于**挑战骰才命中，平局归挑战骰；score 永不能 beat 10 | Rules-Summary p2 |
| match | **双挑战骰点数相同**；Starforged 无「action die match」 | Primer p13、Rules-Summary p2 |
| 负 momentum | momentum < 0 且 \|momentum\| == action die → **取消 action die**，score = stat + adds | Primer p15 |
| burn momentum | 掷后决定，以正 momentum 值**替换** action score；随后重置为 reset；进度投不可 burn | Primer p14 |
| momentum max | 10 − 生效 impacts 数（车辆类仅载具在船时计入）；增加不得超 max | Primer p14 |
| momentum reset | 0 impacts = +2；1 = +1；≥2 = 0 | Rules-Summary p2 |
| 进度标记量 | troublesome 3 格 / dangerous 2 格 / formidable 1 格 / extreme 2 tick / epic 1 tick | Rules-Summary p3 + Primer p16 实证（dangerous = 2 boxes） |
| 进度投 | score = ticks ÷ 4 向下取整（满格数）；仅挑战骰；无 momentum 交互 | Rules-Summary p3 |
| meters | health/spirit/supply 0–5（Datasworn `condition_meters`） | 数据 |
| impacts 封锁 | wounded→health、shaken→spirit、unprepared→supply 不可增加（`prevents_recovery`）；已标记不可重复标记 | Primer p21、数据 |
| cursed 永久 | cursed 为永久 impact（PDF p5/p21）；Datasworn 0.0.10 未标 `permanent`，引擎以规则修正表（EXTRA_PERMANENT_IMPACTS）强制 | Primer p21 + 数据缺口 |
| oracle d100 | 两枚 d10（十位/个位，10 记 0，00=100）；`match = 十位==个位` | Primer p26 |
| 建档属性 | 每项 1–3（向导按 {3,2,2,1,1} 分配，M4 落地）；引擎校验整数 0–5 | Primer p8 |
| 建档资产 | 创建时任选 3 个资产 + STARSHIP command vehicle 固定入列；首 ability 启用 | Rules-Summary p6 |
| 背景誓约 | 建角时决定（可带 rank），落为 kind='vow' 初始进度轨 | Primer p8 |
| 起始 momentum | +2 | 角色卡 reset 默认 +2 |
| legacy 经验 | 每新填 1 格（4 ticks）= 2 XP；已清空轨每格 = 1 XP；填满第 10 格即清空（十字标记，进度投按 10） | Rules-Summary p4 |
| Advance 花费 | 新资产 3 XP；既有资产解锁第 2/3 ability 各 2 XP | Rules-Summary p4/p6 |
| legacy 奖励表 | per rank：troublesome=1 tick、dangerous=2 ticks、formidable=1 box、extreme=2 boxes、epic=3 boxes；「降一档」取低档值 | Fulfill Your Vow / Forge a Bond / Finish an Expedition move 文本 |
| mark progress 可叠加 | move 令 mark progress 且资产 ability 对同一动作再令 mark progress 时可再标 | Rules-Summary p3 |
| battered 封锁 | 车辆 battered 已标记时不可提高该载具 integrity（须先 Repair 清除） | Rules-Summary p5 |
| 载具 troubles 生效条件 | battered/cursed 仅当在船（aboard）计入 momentum 派生值 | Rules-Summary p5 |
| count_as_impact | 持有该资产即计 1 个 impact（Oathbreaker） | 数据 + move 文本 |
| out_of_action / broken | `disables_asset` 控制：资产能力停摆（增强不提供、计量器不可作触发来源），数值调整仍允许 | 数据（companion/module/path） |

## 2. 包结构（INV-4：无 DOM、无网络、无 React）

```
packages/engine/src/
├── state/          # CampaignState 类型、createNewCampaign、migrateCampaignState、派生函数（momentumMax/Reset、meter 封锁）
├── dice/           # rng.ts（Rng、mulberry32、cryptoRng）、rolls.ts（掷骰与结局判定纯函数）
├── tracks/         # rank→tick 换算、ticks 封顶、legacy 满轨清零、legacyRewardTicks 奖励表
├── assets/         # M5：实例化默认值、control 元数据、enhance 查询、requirement 校验
├── oracle/         # rollOracle（d100 两骰 + 二分查找 + {{table:...}} 递归展开）
├── events.ts       # EngineEvent 联合类型
├── audit.ts        # AuditEntry / EngineOutcome / EngineError 类型
└── reducer.ts      # reduce(state, event, ctx)：唯一状态变更入口
```

依赖：仅 `@starwright/data`（类型与索引）；zod 不进引擎（入参校验手写，错误码返回）。

## 3. 事件与结算（M2 全集）

所有事件经 `reduce` 执行；返回 `ReduceResult`：

```ts
type ReduceResult =
  | { ok: true;  state: CampaignState; outcome: EngineOutcome; log: AuditEntry }
  | { ok: false; state: CampaignState; error: EngineError;     log: AuditEntry }; // state 保持不变
```

失败事件不落日志（journal 只记成功结算），但返回 `log`（AuditEntry）供 GM 面板与测试审计；AI 层（M3）把 `error` 以 `{ error: code, message, hint }` 回传模型自纠。

| 事件 | 行为 | 失败错误码 |
|---|---|---|
| `action_roll { stat?, meter?, add?, assetMeter? }` | 掷 action d10 + 2×challenge d10；按 §1 判定（截断 10、负 momentum 取消、match）；不自动 burn；M4 起 stat/meter 可皆缺省（见 §3.2）；M5 起 `assetMeter { assetId, control }` 以资产计量值为 base（与 stat/meter 互斥，见 §3.3） | `both_roll_selections`、`invalid_add`、`unknown_asset`、`asset_control_missing` |
| `progress_roll { trackId }` | 掷 2×challenge d10，score = 满格数（legacy 已清空按 10；M4 起接受 legacy 轨 id，见 §3.2） | `unknown_track` |
| `burn_momentum { rollId }` | 找到 journal 中未 burn 的 action_roll 结算，以当前 momentum（须 >0）替换 score 重判；momentum 重置 | `unknown_roll`、`already_burned`、`burn_requires_positive_momentum` |
| `adjust_momentum { delta }` | 夹取 [-6, momentumMax]；delta=0 拒绝 | `invalid_delta` |
| `adjust_meter { meter, delta }` | 夹取 [0,5]；**增加**受 impacts 封锁（wounded→health 等） | `invalid_delta`、`meter_recovery_blocked` |
| `mark_impact { impactId, assetId? }` | 须存在于 Datasworn `rules.impacts`；不可重复标记；车辆类须带 assetId | `unknown_impact`、`impact_already_marked`、`vehicle_impact_requires_asset` |
| `clear_impact { impactId }` | permanent 类拒绝清除 | `unknown_impact`、`impact_not_marked`、`impact_permanent` |
| `add_track { title, rank, kind? }` | 生成 `track-<seq>` id | `invalid_rank` |
| `mark_progress { trackId, marks?, ticks? }` | 默认 1 次；marks × rank 量或显式 ticks；封顶 40 | `unknown_track`、`ambiguous_mark` |
| `adjust_legacy { legacy, ticks }` | M5 修订：ticks 允许负值（纽带减损，floor 0，无 XP）；正向刻度跨格边界自动结算经验（每新格 2 XP，已清空轨 1 XP）；填满 40 tick 即清空（ticks 归零、cleared=true），同一次调用内先按清空前费率计 XP | `unknown_legacy`、`invalid_ticks` |
| `set_flag { key, value }` | 场景 flag 写入 | — |
| `add_journal_entry { text }` | 叙事笔记 | `empty_text` |
| `set_aboard_vehicle { assetIds }` | 在船载具列表（影响车辆类 impact 生效与 momentum 派生值） | — |
| `end_scene` | scene.index + 1 | — |

`roll_oracle` 保持引擎函数形态（M2 直接可用）：M3 起由 AI 工具层 `roll_oracle` 直接调用（经 INV-2 的 ctx.rng 掷骰），不产生 journal settlement，骰值经工具结果与 GM 面板审计。

### 3.1 建档输入（M4）

`createNewCampaign(input)` 是 reducer 之外的唯一状态初始化入口（journal 为空、审计无从记录，属建档而非对局事件）。M4 扩展 `NewCampaignInput`：

- `truths?: Record<string, string>`：truth key → 选项序号（'0'…）；形状校验（键非空）。
- `assets?: string[]`：初始资产 id 列表；实例化为 `{ id: 'asset-<n>', assetId, enabledAbilities: [0], optionValues: {}, meters: {} }`（Rules-Summary p6：首 ability 随获得启用）。id 合法性由宿主对照 index 校验（与 truths 同策略，引擎只做形状校验）。
- `backgroundVow?: { title: string; rank: ChallengeRank | null }`：经与 `add_track` 相同的生成逻辑落为 `track-<seq>`（kind='vow'），`seq` 顺延——同输入同输出，回放仍确定。

### 3.2 事件修订（M4）

| 事件 | 修订 | 说明 |
|---|---|---|
| `action_roll` | `stat`/`meter` 均可缺省（最多其一） | 缺省时 baseValue=0；供 Develop Your Relationship 的「roll +rank」（rank 值经 add 传入）。原 `no_roll_selection`（二者缺一不可）改为「二者不可同时提供」→ `both_roll_selections` |
| `progress_roll` | `trackId` 亦接受 legacy 轨 id | `quests_legacy/bonds_legacy/discoveries_legacy`：score=满格数（ticks÷4），已清空按 10（Rules-Summary p4「Rolling on a Legacy Track」）；供 special_track move（Overcome Destruction / Continue a Legacy / Seek Safe Haven）使用 |

### 3.3 资产自动化事件（M5）

新事件（皆入 §3 通用 ReduceResult 流程）：

| 事件 | 行为 | 失败错误码 |
|---|---|---|
| `add_asset { assetId, payWithExperience?, attachTo? }` | 以 Datasworn 定义实例化（id=`asset-<seq>`，首 ability 启用；condition_meter 按 value 初值入 meters，checkbox/card_flip 入 controls=false）；`payWithExperience` 扣 3 XP（Advance 购新资产）；`attachTo` 校验目标实例定义的 `attachments.assets` glob（如 starship 挂 module） | `unknown_asset`、`insufficient_experience`、`invalid_attachment` |
| `discard_asset { assetId }` | 移除实例并连带清除其名下 impacts（assetId 匹配的 MarkedImpact） | `unknown_asset` |
| `enable_ability { assetId, abilityIndex, payWithExperience?, requirementConfirmed? }` | 解锁禁用 ability；`requirement` 为 legacy 格数断言（"fill N boxes on your X legacy track"）时校验之，否则要求 `requirementConfirmed`（叙事前置，审计留痕）；`payWithExperience` 扣 2 XP（Advance 升级） | `unknown_asset`、`ability_not_found`、`ability_already_enabled`、`requirement_unmet`、`requirement_confirmation_required`、`insufficient_experience` |
| `adjust_asset_meter { assetId, control, delta }` | 资产计量器夹取 [min,max]；battered 已标记的载具拒绝提高 integrity；disables_asset 控制为真不影响数值调整（治疗同伴仍可） | `unknown_asset`、`asset_control_missing`、`invalid_delta`、`integrity_recovery_blocked` |
| `set_asset_control { assetId, control, value }` | checkbox/card_flip 布尔控制（out_of_action/broken/active 等）；`is_impact: true` 的控制（battered/cursed）不经此事件——走 mark_impact/clear_impact 以保单一状态源 | `unknown_asset`、`asset_control_missing`、`control_is_impact`、`invalid_control_value` |
| `remove_track { trackId }` | 移除进度轨（誓言兑现/弃置、纽带成立后的 connection 轨清账） | `unknown_track` |
| `update_track { trackId, title?, rank?, ticks? }` | move 文本落地：重掷清格（ticks 显式值 0–40）、升档（rank）、改名 | `unknown_track`、`invalid_rank`、`invalid_ticks` |

`action_roll` 的 `assetMeter { assetId, control }`（与 stat/meter 互斥）：baseValue = 实例 `meters[control]`；`asset_control`/`attached_asset_control` 触发（Companion Takes a Hit、Withstand Damage、Raise Shields 等）由工具层解析出 assetId 后走此通道；burn_momentum 重判读取 journal 中原结算的 assetMeter/baseValue。`disables_asset` 控制为真的实例不可作触发来源（返回 `asset_disabled`，由工具层校验）。

**count_as_impact**：`momentumMax`/`momentumReset` 的 impact 计数 = 角色 impacts（车辆类限在船）+ 持有的 `count_as_impact` 资产数。

**enhance 查询**：`listEnhancements(state, index, moveId)` 纯函数——遍历实例已启用 ability 的 `enhance_moves[]`，`enhances[]` 对 moveId 做 `*` 通配（仅分类段）；`disables_asset` 为真的实例跳过；返回 `{ instanceId, assetId, abilityIndex, text(触发说明), abilityText }`。引擎不自动应用增强（加值经 action_roll `add`、其余由上层按文本用既有事件落地）。

### 3.4 状态版本与迁移

`STATE_VERSION = 2`（M5）：新增 `CampaignState.experience`（默认 0）、`AssetInstance.controls`（默认 {}）、`AssetInstance.attachedTo`（缺省）。
`STATE_VERSION = 3`（玩家旗标）：新增 `CampaignState.contentFlags: string[]`（默认 []）——玩家在向导按 Set a Flag 设立的旗标，区别于 `scene.flags`（AI 工作记忆）；不经任何引擎事件暴露（AI 无权改动，玩家职责）。

`migrateCampaignState(raw)` 为**迁移链**：v1 → v2（experience=0、逐资产 controls 补默认）→ v3（contentFlags=[]），幂等；版本 >3 或形状不符抛 `version_mismatch`。迁移不产生事件/journal（建档级操作，与 createNewCampaign 同类）。

`createNewCampaign` 的 `NewCampaignInput.contentFlags?: string[]`：可选；逐条 trim、丢弃空串、去重后入库，非法输入（非数组/非字符串元素）抛 `invalid_input`。

## 4. 结算明细（EngineOutcome，UI 结算卡片与 AI tool 结果共用）

- `action_roll`：`{ kind:'action_roll', rollId, dice:{actionDie,challenge:[c1,c2]}, stat?, meter?, assetMeter?, add, rawScore, score, canceledActionDie, match, outcome, burned }`
- `progress_roll`：`{ kind:'progress_roll', rollId, trackId, ticks, score, dice:{challenge:[c1,c2]}, outcome }`
- `adjust_momentum/meter/mark_impact/...`：各自 `{ kind, ...变化前后值 }`
- M5 增：`add_asset/discard_asset/enable_ability/adjust_asset_meter/set_asset_control/remove_track/update_track` 各自 `{ kind, ...实例快照或变化前后值 }`；`adjust_legacy` 增 `experienceGained` 与 `experience`（负刻度为 0）；`asset_*` 类 outcome 附资产名与 meters/controls 快照（UI 卡片直读）
- `oracle`（函数）：`{ tableId, roll, dice:{tens,units}, match, rowText, text(展开后), suggestion?, nested:[...] }`

掷骰记录（INV-2）：outcome 内含全部骰值与出处；AuditEntry 记录事件入参、ok/error、结算 id，形成顺序审计链。

## 5. 确定性与回放

- id 一律来自 `state.seq` 自增（journal、track、roll）；不用随机 id。
- `mulberry32(seed)` 注入 `ctx.rng` 后，同一事件序列从同一初始状态回放得到逐项一致的 ReduceResult 序列（集成测试断言）。
- journal 滚动上限 500 条（新事件入列，超限移除最旧 settlement/note）；`seq` 不回退。

## 6. 测试矩阵（Vitest）

1. `rolls`：动作骰边界（7–10 vs 挑战骰组合）、score 截断 10、平局 miss、match 判定、负 momentum 取消、burn 重判与重置、进度投公式。
2. `momentum/impacts`：max/reset 随 impacts 数变化、车辆类在船/离船、burn 后 reset、meter 夹取与封锁、重复标记/永久类清除拒绝。
3. `tracks`：rank→tick 表、marks 倍数、封顶 40、legacy 满轨 cleared、进度投 score。
4. `oracle`：真实数据表（core/action、truth 子表）区间行、`{{table:...}}` 递归展开、环/深度保护、match 标记。
5. **property（10k）**：固定种子 10k 次随机掷骰，独立重算结局断言一致；分布校验（stat 0 无加值时 strong≈0.285、weak≈0.33、miss≈0.385，±2%）；momentum/meter 夹取不变量。
6. **回放集成**：固定种子事件序列「建角 → 立誓(add_track/mark_progress) → action_roll+burn → 战斗(progress_roll) → 负面结算(meter 封锁→清除→恢复) → end_scene」断言全量状态与审计链；二次回放逐项一致。
7. **建档输入（M4）**：truths/assets/backgroundVow 输入的状态形状（asset-<n>/track-<seq> id、enabledAbilities=[0]、seq 顺延）；缺省输入回退 M3 行为；`action_roll` 无选择（base 0）与 `both_roll_selections` 边界；`progress_roll` 对 legacy 轨（含 cleared→10）。
8. **资产自动化（M5）**：实例化默认值（meters/controls/首 ability）；add_asset（3 XP/挂载 glob 校验）；enable_ability（requirement legacy 格数断言、requirementConfirmed、2 XP、重复启用拒绝）；adjust_asset_meter（夹取、battered 封锁 integrity）；set_asset_control（is_impact 拒绝）；discard_asset 连带清 impacts；count_as_impact 计入 momentumMax/Reset；disables_asset 停摆（enhance 跳过、触发来源拒绝）；listEnhancements（通配命中、禁用 ability 不计、asset_control 增强文本）；action_roll assetMeter base 与 burn 重判。
9. **legacy/经验（M5）**：adjust_legacy 跨格 +2 XP/格（已清空轨 +1）；第 10 格填满同调用内清空（ticks=0、cleared）；负刻度 floor 0 无 XP；legacyRewardTicks 五档与降档；remove_track/update_track（重掷清格、升档）；migrateCampaignState v1→v2 幂等。

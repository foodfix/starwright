# M5 验收清单 — 资产全自动化与 legacy

> 依据 `docs/DEVELOPMENT.md` §11「M5 资产全自动化与 legacy」展开，设计细节见 `docs/engine-design.md` §3.3/§3.4/§8/§9、`docs/ai-design.md` §1/§5/§5.2/§6/§8/§9。

## 1. 交付物

| # | 交付物 | 说明 | 状态 |
|---|---|---|---|
| D1 | 文档先行 | `DEVELOPMENT.md` §6.1/§6.3/§6.4/§7.3/§8.4 与 `engine-design.md` §1/§2/§3/§3.3/§3.4/§4/§6、`ai-design.md` §1/§5/§5.2/§6/§8/§9 先于代码修订 | ✅ |
| D2 | data：资产内嵌 moves 注册 | `abilities[].moves`（12 个）注册进 `byId` 与 move 目录「Assets」分类；目录总数 56+12=68（Seek Safe Haven special_track 在列） | ✅ |
| D3 | engine：状态 v2 与迁移 | `STATE_VERSION=2`；`experience` 字段；AssetInstance 增 `controls`/`attachedTo`；`migrateCampaignState` v1→v2（幂等，版本不符抛 `version_mismatch`） | ✅ |
| D4 | engine：资产事件 | `add_asset`（3 XP/挂载 glob）/`discard_asset`（连带清 impacts）/`enable_ability`（requirement 断言+确认+2 XP）/`adjust_asset_meter`（夹取+battered 封锁）/`set_asset_control`（is_impact 拒绝）/`remove_track`/`update_track` | ✅ |
| D5 | engine：assetMeter 触发 | `action_roll.assetMeter { assetId, control }`（与 stat/meter 互斥 → `both_roll_selections`）；burn_momentum 重判读取原 assetMeter/baseValue | ✅ |
| D6 | engine：enhance 查询与 count_as_impact | `listEnhancements`（`*` 通配/禁用过滤）；count_as_impact 计入 momentumMax/Reset；disables_asset 停摆 | ✅ |
| D7 | engine：legacy 经验 | `adjust_legacy` 跨格自动 XP（2/格，清空轨 1/格）、负刻度（floor 0，无 XP）、第 10 格清空续转；`legacyRewardTicks` 五档+降档 | ✅ |
| D8 | ai：make_move 资产联动 | `asset_id` 参数；asset_control/attached_asset_control 解析（唯一匹配自动选定/`asset_control_ambiguous`/`asset_control_no_asset`/`asset_disabled`）；`enhancements[]` 入 payload；`asset_control_unsupported` 移除；Seek Safe Haven = discoveries_legacy | ✅ |
| D9 | ai：11 个新工具 | add_asset/discard_asset/enable_ability/adjust_asset_meter/set_asset_control/adjust_legacy/update_track/fulfill_vow/forsake_vow/forge_bond/mark_bond_decrease（工具总数 26，schema 与 §7.3 登记一致） | ✅ |
| D10 | ai：提示词 | GM 规范（en/zh）增 Advance 经验纪律、誓言/纽带生命周期、资产计量器指引；快照增 XP、LEGACY cleared 标记、资产 instanceId/meters/controls/挂载行 | ✅ |
| D11 | web：迁移与展示 | 载入经 `migrateCampaignState`（迁移失败回向导）；状态栏 XP 行、资产计量器/激活 controls/挂载展示；结算卡片支持全部新 outcome 种类与新工具标题 | ✅ |
| D12 | 测试 | data 18（+1 内嵌 move 注册）、engine 98（+23 资产/legacy/迁移矩阵）、ai 76（+13 M5 工具矩阵与资产联动、+3 参数归一化回归）、web 16；全绿 | ✅ |
| D13 | ai：工具参数归一化 | 试玩反馈：GLM/Qwen 系网关把 `function.arguments` 序列化为 `<arg_key>/<arg_value>` 标签或重复键 JSON → `args.ts` `parseToolArguments` 统一还原标准键值（ai-design §3.4）；`set_flag` 错误补 hint | ✅ |

## 2. 验收标准与验证命令

| # | 标准 | 验证方式 | 记录 |
|---|---|---|---|
| A1 | `pnpm lint` 通过 | 退出码 0 | ✅ 0 error 0 warning |
| A2 | `pnpm typecheck` 通过 | `tsc -b` 退出码 0 | ✅ |
| A3 | `pnpm test` 通过 | Vitest：data 18 + engine 98 + ai 76 + web 16 = 208 全过 | ✅ |
| A4 | 资产条件触发单测通过（里程碑验收项） | engine `assets.test`：requirement 格数断言（homesteader 4 boxes bonds）/requirementConfirmed/count_as_impact（momentumMax 10→9）/disables_asset 停摆；ai `tools.test`：companion_takes_a_hit（banshee 自动选定，`selection: "asset:asset-0(health)"`）与 withstand_damage（ship integrity）正常结算 | ✅ |
| A5 | legacy 进度可兑现经验（里程碑验收项） | engine：39+4 ticks → +18/+2 XP → 清空续转 1 XP/格；ai：adjust_legacy +8 ticks → 4 XP；fulfill_vow 奖励入 quests_legacy（dangerous=2 ticks） | ✅ |
| A6 | 56+12 move 全接入 | `tools.test`「resolves every move in the catalog」：播种 starship+banshee+grappler+internal_refit 后 68 个 move 遍历结算（42 action/5 progress/18 no_roll/3 special_track），无 `unsupported` | ✅ |
| A7 | 26 工具与 §7.3 登记一致 | `TOOL_NAMES`/`TOOL_SPECS` 与 DEVELOPMENT.md §7.3 表逐一对照（代码核查） | ✅ |
| A8 | v1 存档迁移 | engine 单测：v1 形状 → v2 补默认值（experience=0、controls={}），幂等；web restore 经 migrateCampaignState，迁移失败回向导 | ✅ |
| A9 | 种子回放确定性 | 引擎回放集成测试回归通过（98 引擎测试含 replay 3 项）；资产 id 一律 `asset-<seq>`（审计/journal 同源），同种子同事件序列逐项一致 | ✅ |
| A10 | `pnpm build` 通过 | 三包 tsc -b + web vite build（448.58 kB bundle，starforged.json 拷入 dist/data/） | ✅ |
| A11 | 真实模型回归（真实验证） | 手工：DeepSeek/Ollama 各一次含资产/legacy 交互的对话（对照 §4 步骤） | ⬜ 待人工 |

## 3. 手工检查项（双通道试玩，M3 起适用）

| # | 检查 | 记录 |
|---|---|---|
| H1 | DeepSeek（云）试玩 30 分钟：触发 Companion Takes a Hit / Withstand Damage（asset_id 结算）；购买/升级资产（XP 纪律）；Fulfill Your Vow 全流程 | ⬜ 待人工 |
| H2 | Ollama（本地 qwen 系）试玩 30 分钟：同上 + enhancements 提示出现 + Forsake Your Vow / Forge a Bond 抽查 | ⬜ 待人工 |
| H3 | Key 安全：Key 仅 localStorage，不入 Dexie 存档/日志/GM 面板 | ✅ 代码核查：`db.ts` 仅落 `CampaignState`/聊天流；M5 未改动落库面 |
| H4 | XP 纪律：模型无法凭空给经验/资产——add_asset/enable_ability 不带 pay_with_experience 时免费入列仅限叙事馈赠，快照 XP 行与 GM 面板可审计 | ✅ 自动化覆盖：`insufficient_experience` 拒绝（engine/ai 单测）；XP 仅由 adjust_legacy 自动累积，无独立授 XP 工具 |

## 4. 验证记录

- 日期：2026-09-15（自动化部分）
- 环境：Node v24.16.0 / pnpm 12.4.1（CI 为 Node 22）
- `pnpm lint`：0 error 0 warning
- `pnpm typecheck`：tsc -b（data/engine/ai/web 项目引用）0 error
- `pnpm test`：data 18 + engine 98 + ai 76 + web 16 = 208 全过
- `pnpm build`：三包 tsc -b 通过；web vite build 成功（162 modules，starforged.json 拷入 dist/data/）
- `pnpm format:check`：全部通过
- dev 冒烟：vite 起 5199 端口——`/` 200、`/data/starforged.json` 200（1,433,427 字节）、CharacterPanel/SettlementCard/wizard 模块经 vite 转换 200
- 结论：自动化验收全部通过；A11/H1/H2 属真实模型人工试玩，留待验证后勾选。

### 人工验证步骤（A11/H1/H2）

1. `pnpm dev` 载入既有存档（或向导新建）；确认状态栏出现 XP 行与资产计量器（starship integrity 5/5 等）。
2. 对话中攻击同伴/载具触发 Companion Takes a Hit / Withstand Damage；核对结算卡片显示资产计量来源（asset:asset-0(health)）与骰值；对受伤同伴 Heal、对载具 Repair。
3. 推进誓言至可兑现后 Fulfill Your Vow：核对 quests_legacy 增加对应刻度、XP 按格累积；XP 足够时 Add asset（pay_with_experience）核对扣费。
4. 触发一次带 enhancements 的 move（如 Starship ability 2 的 Withstand Damage 变体）；确认 payload 列出增强项且模型先请示再应用。

### 实现备注

- **实例 id 与 seq**：每次 `reduce` 消耗 seq（journal id + audit id），因此资产实例 id 形如 `asset-<n>` 随事件历史递增；工具入参与快照均以 instanceId 寻址，模型从 ASSETS 快照行读取。
- **battered 封锁实现**：Datasworn 中 battered/cursed 是 integrity meter 的嵌套子控制（`is_impact: true`）；引擎经 `impactControlsUnderMeter(def, control)` 查找被标记的嵌套 impact 以拒绝 `adjust_asset_meter` 正向调整。
- **impact 级 checkbox 单一状态源**：`set_asset_control` 对 `is_impact` 控制返回 `control_is_impact`，标记/清除必须走 `mark_impact`/`clear_impact`（带 assetId），避免与 momentum 派生值的双状态源。
- **Earn Experience 自动化**：XP 在 `adjust_legacy` 跨格时自动结算（Rules-Summary p4），`earn_experience` move 本体仍可经 make_move 获取其规则文本；模型无工具可手工记 XP。
- **legacy 奖励表**：`legacyRewardTicks`（troublesome=1 tick / dangerous=2 / formidable=4 / extreme=8 / epic=12，降档取低档）与进度标记表（MARK_TICKS_BY_RANK）是两张不同的表，勿混用。
- **attached_asset_control**：候选限制为「已挂载模块的宿主载具」（owned modules 的 attachedTo 目标集），Raise Shields 等内嵌 move 因此可对宿主 integrity 掷骰。
- **试玩反馈修复（GLM/Qwen 参数格式）**：真实对局中 `set_flag` 以 `<arg_key>/<arg_value>` 标签参数被拒（`invalid_input`）。根因：部分 OpenAI 兼容网关按模型原生形态序列化 arguments，`JSON.parse` 要么失败、要么因重复键丢失 `key`。修复：`args.ts` 在解析层归一化（标签序列 / 重复键 JSON / 标准 JSON 三态），以真实失败样例作回归测试；`set_flag` 拒绝信息补 hint 供自纠。

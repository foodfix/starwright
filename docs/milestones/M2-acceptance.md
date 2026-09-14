# M2 验收清单 — 引擎核心

> 依据 `docs/DEVELOPMENT.md` §11「M2 引擎核心」与 §11.1 展开，随 `docs/engine-design.md` 实现内容细化。完成时逐项填写验证记录。

## 1. 交付物

| # | 交付物 | 说明 | 状态 |
|---|---|---|---|
| D1 | 规则勘误 | §6.2 与 `docs/engine-design.md` §1 依 Rules-Summary / Primer PDF 修订：momentum 范围 -6…+10、action score 截断 10、burn=替换 score、负 momentum 取消 action die、match=双挑战骰相同、进度 rank 标记量表、cursed 永久 | ✅ |
| D2 | `packages/engine` 状态层 | CampaignState v1（truths/characters/tracks/legacy/assets/scene/journal/momentum/seq）、`createNewCampaign` 校验、派生函数 `momentumMax/momentumReset/countActiveImpacts/blockedMeters/findImpactDef` | ✅ |
| D3 | 骰子与结算 | `Rng` + mulberry32/cryptoRng；`computeActionRoll`（截断、取消、burn、match）、`computeProgressRoll`（满格数、无 momentum 交互） | ✅ |
| D4 | 轨道 | rank→tick 量表（troublesome 12/dangerous 8/formidable 4/extreme 2/epic 1）、ticks 封顶 40、legacy 满轨 cleared | ✅ |
| D5 | Oracle | `rollD100`（两枚 d10 + match）、`rollOracle` 区间二分 + `{{table:...}}` 递归展开（深度上限、嵌套记录） | ✅ |
| D6 | 事件 reducer | 14 类 `EngineEvent`（action_roll/progress_roll/burn_momentum/adjust_momentum/adjust_meter/mark_impact/clear_impact/add_track/mark_progress/adjust_legacy/set_flag/add_journal_entry/set_aboard_vehicle/end_scene）；`ReduceResult` ok/error 联合；结构化错误码；journal 滚动 500；`seq` 确定性 id | ✅ |
| D7 | 测试 | 单测（骰值边界/规则/事件/错误码）+ property 10k×4 + 纯函数回放集成（含确定性重放断言） | ✅ 71 通过 |

## 2. 验收标准与验证命令

| # | 标准 | 验证方式 | 记录 |
|---|---|---|---|
| A1 | `pnpm lint` 通过 | 退出码 0 | ✅ |
| A2 | `pnpm typecheck` 通过（strict + noUncheckedIndexedAccess） | 退出码 0 | ✅ |
| A3 | `pnpm test` 通过 | Vitest 摘要：engine 71 + data 15 | ✅ |
| A4 | property 测试 10k 骰通过 | `src/property.test.ts`：分布校验（strong 0.285/weak 0.33/miss 0.385 ±2%）+ 结局独立重算 + clamp 不变量，各 10k 次、种子固定 | ✅ |
| A5 | 纯函数可脱离 UI 跑通结算 | `src/replay.test.ts`：建角→立誓→行动+burn→战斗进度投→伤害/封锁/恢复→legacy→场景收尾，全量状态断言；同种子重放逐项一致 | ✅ |
| A6 | INV-1/2：数值变化仅在引擎内、掷骰由引擎执行 | 事件为唯一入口；outcome 含全部骰值；AI 层（M3）只能经事件结算 | ✅（审计链测试） |
| A7 | INV-4：engine 无 DOM/无网络/无 React | 依赖仅 `@starwright/data`；`globalThis.crypto`/`structuredClone` 均为标准全局 | ✅ |
| A8 | 文档先行 | `docs/DEVELOPMENT.md` §6.1/6.2/6.4/§11 与 `docs/engine-design.md` 先于代码修订 | ✅ |

## 3. 手工检查项

| # | 检查 | 记录 |
|---|---|---|
| H1 | 规则事实逐条对照 `pdfs/Ironsworn-Starforged-Rules-Summary.pdf` / `Rules-Setting-Primer.pdf` | ✅ 见 `docs/engine-design.md` §1 出处列；进度标记量另有 Primer p16「dangerous = 2 boxes」实证 |
| H2 | `data/starforged.json` 未被修改（INV-3） | ✅ `git status` 无 data/ 变更 |
| H3 | cursed 永久性：PDF 与 Datasworn 冲突已文档化并以规则修正表处理 | ✅ `EXTRA_PERMANENT_IMPACTS` + engine-design §1 注记 |

## 4. 验证记录（完成时填写）

- 日期：2026-09-14
- pnpm/node 版本：pnpm 12.4.1 / Node v24.16.0（CI 为 Node 22）
- A1 `pnpm lint`：eslint .，0 error 0 warning
- A2 `pnpm typecheck`：tsc -b（data + engine + web 项目引用），0 error
- A3 `pnpm test`：Vitest data 15 passed（162ms）+ engine 71 passed（2.9s）
- A4 property：4 个 10k 测试全绿（分布/动作骰不变量/burn 不变量/进度与夹取不变量），种子 20260914 固定可复现
- A5 回放集成：3 项全绿（全流程状态断言、种子重放 deep-equal、journal 滚动 500 上限）
- `pnpm build`：data/engine tsc -b 通过，web vite build 成功
- `pnpm format:check`：全部通过
- 结论：M2 验收通过

### 实现备注

- burn momentum 建模为独立事件 `burn_momentum { rollId }`：掷骰后看到骰值再决定（符合规则），重判所需输入（dice/baseValue/stat/add）完整记录在原结算 outcome 中，无需随机数即可复核；重复 burn 以 journal 扫描拒绝。
- id 全部由 `state.seq` 单调计数生成（journal/track/roll/audit），同种子事件序列回放逐字节一致；失败事件不消耗 seq、不落 journal。
- `adjust_momentum` 上限取 `momentumMax`（随 impacts 派生）；impacts 增减不回改历史值，只影响后续夹取——与规则「不能增加超过 max」一致。
- legacy 轨 M2 仅支持刻数累加与满轨 `cleared`（进度投按 10 计）；经验兑换（Earn Experience）与 legacy moves 留待 M5。
- 车辆类 impact（battered/cursed）标记需 `assetId`，仅当 `scene.aboardVehicleAssetIds` 含该 asset 时计入 momentum 派生值。
- M3 工具层落地时，`make_move` 将组合 `action_roll/progress_roll` + move 结局文本（含 `{{table:...}}` 展开），`roll_oracle` 事件包装随工具清单登记。

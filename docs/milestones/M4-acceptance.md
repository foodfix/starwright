# M4 验收清单 — 新档向导与全量动作

> 依据 `docs/DEVELOPMENT.md` §11「M4 新档向导与全量动作」展开，设计细节见 `docs/ai-design.md` §5.1/§9、`docs/engine-design.md` §3.1/§3.2。

## 1. 交付物

| # | 交付物 | 说明 | 状态 |
|---|---|---|---|
| D1 | 文档先行 | `DEVELOPMENT.md` §5.2/§6.4/§7.3/§8.2/§8.4/§11 与 `engine-design.md` §1/§3.1/§3.2/§6、`ai-design.md` §1/§5.1/§6/§8/§9 先于代码修订 | ✅ |
| D2 | data：资产目录树 | `listAssetTree()`：分类 → 资产摘要（id/name/category/首 ability/选项），供向导与 UI；**数据缺口修正**：合成 Ask the Oracle 五档几率 yes/no 表（Datasworn 0.0.10 缺失，阈值见 Rules-Summary p6） | ✅ |
| D3 | engine：建档输入扩展 | `createNewCampaign` 支持 `truths?`/`assets?`（实例化 `asset-<n>`，首 ability 启用）/`backgroundVow?`（`track-<seq>` kind=vow，seq 顺延）；`action_roll` 允许无 stat/meter（二者同给 → `both_roll_selections`）；`progress_roll` 接受 legacy 轨 id（cleared 按 10） | ✅ |
| D4 | ai：make_move 全量接入 | trigger 校验（`invalid_roll_selection`/`roll_selection_required` 附合法项）、highest/lowest 按当前状态自动选值（payload `selection` 注明）、custom→add（+rank）、special_track（Overcome Destruction=bonds_legacy 一掷；Continue a Legacy=三轨各一掷）、no_roll 文本 `{{table:...}}` 展开、内嵌 oracle 自动掷/`oracle_id` 选择/`oracleCandidates`；asset_control 两 move 结构化拒绝（`asset_control_unsupported`，M5） | ✅ |
| D5 | ai：make_move 工具 schema | `oracle_id` 参数与描述更新（Ask the Oracle 五档几率、special_track/legacy 说明） | ✅ |
| D6 | ai：提示词 | 快照增资产行（id/名称/ability 数）；GM 规范增触发校验自纠与 Ask the Oracle `oracle_id` 指引（en/zh 同步） | ✅ |
| D7 | web：Dexie 存档 | `starwright.v1`（saves 表，key='campaign'+'chat'）：战役状态与聊天流（entries/history/工具日志/usage）变更后防抖 500ms 落库；启动载入（version 不符即弃用）；设置页删除存档回向导（连带清空聊天存档） | ✅ |
| D8 | web：新档向导 | Truths（14 类选项 description/quest starter 预览，默认第一项）→ 角色（名字/属性 {3,2,2,1,1} 多重集校验/可选背景誓约+rank）→ 初始资产（Starship 固定 + 任选 3，类别分组+全文搜索）→ Review；完成后 `createNewCampaign` 落库并以 quest starters + 背景誓约自动发送开场 | ✅ |
| D9 | web：资产展示与卡片 | 状态栏资产区（名称/ability 数/选项）；结算卡片支持 `selection`/`rolls[]`（Continue a Legacy 逐轨）/`oracleRolls`/`oracleCandidates`；Datasworn 文本渲染器（`__粗体__`→strong、`[text](id:node)`→带 title 文本，用于向导与结算卡片）；web 引入 vitest | ✅ |
| D10 | 测试 | data 17（资产树/odds 合成表）、engine 75（建档输入/无选择 action_roll/legacy 进度投）、ai 60（56 move 全遍历、trigger 校验、自动选值、special_track、内嵌 oracle、asset_control 拒绝）、web 11（wizard 校验/开场拼装/Datasworn 文本解析） | ✅ |

## 2. 验收标准与验证命令

| # | 标准 | 验证方式 | 记录 |
|---|---|---|---|
| A1 | `pnpm lint` 通过 | 退出码 0 | ✅ 0 error 0 warning |
| A2 | `pnpm typecheck` 通过 | `tsc -b` 退出码 0（含 apps/web 项目引用） | ✅ |
| A3 | `pnpm test` 通过 | Vitest：data 17 + engine 75 + ai 60 + web 11 = 163 全过 | ✅ |
| A4 | 12 类 move 全接入 | `tools.test.ts`「resolves every move in the catalog」：56 个 move 遍历调用——31 action_roll/5 progress_roll/18 no_roll 正常结算；2 special_track 经 legacy 轨结算；2 asset_control 返回 `asset_control_unsupported`（M5 行为契约） | ✅ |
| A5 | oracles 全目录 | `roll_oracle` 对真实表掷骰成功（含 truth 子表合成 id）；Ask the Oracle 五档 odds 表可经 `oracle_id`/`roll_oracle` 调用；目录树入提示词 | ✅ |
| A6 | INV-1/2 保持 | 全部数值变化经 `reduce`；掷骰仅引擎（伪模型纯文本宣称不改变状态）回归通过（ai 60 项内） | ✅ |
| A7 | 向导建角入库 | 代码核查+单测：`validateWizardInput`/`createNewCampaign` 输入→状态形状（starship 前置、vow 轨）；Dexie 防抖落库/载入/删除；浏览器流程见 §4 | ✅（自动化部分） |
| A8 | 种子回放确定性 | 建档输入确定：同输入同输出（`asset-<n>`/`track-<seq>`、seq 顺延）；引擎回放集成测试回归通过 | ✅ |
| A9 | `pnpm build` 通过 | 三包 tsc -b + web vite build（starforged.json 拷入 dist/data/） | ✅ |
| A10 | 真实模型回归（真实验证） | 手工：DeepSeek/Ollama 各一次含 make_move 结算对话（对照 §4 步骤） | ⬜ 待人工 |

## 3. 手工检查项（双通道试玩，M3 起适用）

| # | 检查 | 记录 |
|---|---|---|
| H1 | DeepSeek（云）试玩 30 分钟：向导建角（truths/stats/资产/背景誓约）→ 开场自动叙述 → 含 move 结算对话 → 刷新续玩 | ⬜ 待人工（步骤见 §4） |
| H2 | Ollama（本地 qwen 系）试玩 30 分钟：同上 + Ask the Oracle（oracle_id 选择）与 special_track move 抽查 | ⬜ 待人工（步骤见 §4） |
| H3 | Key 安全：Key 仅 localStorage，不入 Dexie 存档/日志/GM 面板 | ✅ 代码核查：`db.ts` 仅落 `CampaignState`；settings/chat/GM 面板数据均不含 key |
| H4 | 向导约束：属性非 {3,2,2,1,1}、资产 ≠3、truths 缺选、名字为空时禁止提交 | ✅ 自动覆盖（`wizard.test.ts` 7 项校验单测；UI Next 按钮 stepOk 同步禁用） |

## 4. 验证记录

- 日期：2026-09-15（自动化部分）
- 环境：Node v24.16.0 / pnpm 12.4.1（CI 为 Node 22）
- `pnpm lint`：0 error 0 warning
- `pnpm typecheck`：tsc -b（data/engine/ai/web 项目引用）0 error
- `pnpm test`：data 17 + engine 75 + ai 60 + web 11 = 163 全过
- `pnpm build`：三包 tsc -b 通过；web vite build 成功（156 modules，starforged.json 拷入 dist/data/）
- `pnpm format:check`：全部通过
- dev 冒烟：`pnpm dev` 页面 200、`/data/starforged.json` 200（1,433,427 字节）；新模块（Wizard/db/campaign）经 vite 转换 200
- 结论：自动化验收全部通过；A10/H1/H2 属真实模型人工试玩，留待验证后勾选。

### 人工验证步骤（A10/H1/H2）

1. `pnpm dev` → 向导：依次选 14 类 truths、命名并分配 {3,2,2,1,1}、可选背景誓约、确认 Starship + 任选 3 资产 → Begin the campaign；观察开场自动叙述（AI 未配置时先在 ⚙ Settings 配置并 Test connection）。
2. 触发一次 action_roll move（如 Face Danger）与一次进度 move；核对结算卡片与状态栏；触发 Ask the Oracle 验证 oracle_id 选择；对照 Rules-Summary 抽查一次进度投。
3. 刷新页面：应跳过向导直接载入存档（journal/轨道/资产保持）；设置页 Delete campaign… 确认后应回到向导。
4. 工具预算调至 2 复验预算收尾。

### 实现备注

- **数据缺口**：Datasworn 0.0.10 的 Ask the Oracle move 引用五张几率表 id，但 oracles 树中无对应 rollable 节点——data 层按 Rules-Summary p6 机制阈值合成 yes/no 表（`starforged/oracles/moves/ask_the_oracle/{small_chance,unlikely,fifty_fifty,likely,almost_certain}`），非 PDF 文本复制。
- asset_control 触发的 2 个 move（Companion Takes a Hit / Withstand Damage）依赖 M5 资产计量器，M4 返回 `asset_control_unsupported` 结构化错误（含 hint），不计为接入失败。
- `develop_your_relationship`（+rank 投）促成引擎修订：action_roll 允许无 stat/meter（base=0，rank 经 add 传入）；原 `no_roll_selection` 错误码被 `both_roll_selections` 替代。
- ~~聊天流不落库~~ → 试玩反馈后提前落地：聊天流与战役状态同库保存（key='chat'），刷新后叙述完整恢复；原计划推迟至 M6。
- Dexie 不可用（隐私模式等）时自动降级为内存运行，不阻塞游戏。

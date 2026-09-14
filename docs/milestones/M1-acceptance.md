# M1 验收清单 — 骨架与数据

> 依据 `docs/DEVELOPMENT.md` §11「M1 骨架与数据」与 §11.1 展开。完成时逐项填写验证记录。

## 1. 交付物

| # | 交付物 | 说明 | 状态 |
|---|---|---|---|
| D1 | pnpm workspace | `pnpm-workspace.yaml` 覆盖 `apps/*`、`packages/*`；root scripts：`lint/typecheck/test/dev/build` | ✅ |
| D2 | 工具链 | Vite（apps/web）+ TypeScript strict（含 `noUncheckedIndexedAccess`）+ ESLint（typescript-eslint 推荐集）+ Prettier（单引号/分号/100 列）+ Vitest | ✅ |
| D3 | CI | `.github/workflows/ci.yml`：lint + typecheck + test + build（Node 22 LTS，pnpm 缓存） | ✅ |
| D4 | `packages/data` | zod schema（Datasworn 子集，未知键透传）、`loadStarforged` 加载校验、`StarforgedIndex`（byId / data / move 目录树 / oracle 树与区间预处理 / asset / truth，含 truth 子表合成 id）、`findRowByRoll` 二分查找 | ✅ |
| D5 | `apps/web` 骨架页 | React + Vite + TS；`pnpm dev` 显示骨架页；启动时 fetch `starforged.json` 走 `loadStarforged` 并展示数据规模 | ✅ |
| D6 | data 单测 | 抽查：face_danger（trigger 条件）、core/action oracle（区间与查找）、starship 资产（abilities/controls）、cataclysm truth（选项与子表）；空域跳过 warning | ✅ |

## 2. 验收标准与验证命令

| # | 标准 | 验证方式 | 记录 |
|---|---|---|---|
| A1 | `pnpm lint` 通过 | 命令退出码 0 | ✅ |
| A2 | `pnpm typecheck` 通过（tsc -b，strict + noUncheckedIndexedAccess） | 命令退出码 0 | ✅ |
| A3 | `pnpm test` 通过（data 抽查单测全绿） | Vitest 摘要 | ✅ 15/15 |
| A4 | `pnpm build` 成功（web 产物含 `starforged.json` 静态资源） | 构建输出检查 | ✅ dist/data/starforged.json |
| A5 | `pnpm dev` 显示骨架页并正确展示数据规模（moves/oracles/assets/truths 数量） | 手工/dev-server 冒烟 | ✅ 见 H1 |
| A6 | CI 工作流配置存在且本地三命令等价可跑 | 文件检查（推送后由 GitHub Actions 兜底） | ✅ |
| A7 | INV-4 遵守：`packages/data` 无 DOM/网络依赖（加载为纯函数，raw 由调用方提供） | 依赖与导入检查 | ✅ 运行时仅 zod |

## 3. 手工检查项

| # | 检查 | 记录 |
|---|---|---|
| H1 | 骨架页数字与数据实况一致（56 moves / 14 oracle 分类 / 87 assets / 14 truths） | ✅ 单测断言同值；dev server 冒烟返回页面 + `/data/starforged.json` 200（1.4 MB） |
| H2 | `data/starforged.json` 未被修改（INV-3，只读） | ✅ `git status` 无 data/ 变更；`.prettierignore` 排除 data/ |

## 4. 验证记录（完成时填写）

- 日期：2026-09-14
- pnpm/node 版本：pnpm 12.4.1 / Node v24.16.0（CI 为 Node 22）
- A1 `pnpm lint`：eslint .，0 error 0 warning
- A2 `pnpm typecheck`：tsc -b（data + web 项目引用），0 error
- A3 `pnpm test`：Vitest 15 passed（loadStarforged / moves / oracles / assets / truths 抽查）
- A4 `pnpm build`：vite build 成功，产物含 `dist/data/starforged.json`
- A5 `pnpm dev`：Vite 5173 端口返回骨架页 HTML；`/data/starforged.json` HTTP 200；App.tsx 经 workspace 源码解析 `@starwright/data`
- H1/H2：通过
- 结论：M1 验收通过

### 实现备注

- `packages/data` 通过 workspace 协议以 TS 源码形式被 web/vitest 直接消费（`main/types` 指向 `src/index.ts`），不预打包；`tsc -b` 仅做声明产出与类型检查。
- truth 子表以合成 id `starforged/truths/<key>/<optionKey>` 注册进 byId 与 oracle rows 预处理表，`{{table:...}}` 引用可经 `getOracle`/`getOracleRows` 统一解析。
- 数据实况与文档 §5.1 已同步修订：`roll_type` 含 `special_track`；trigger `method` ∈ player_choice/progress_roll/highest/lowest/all；`enhances` 可为 null；truth `options` 为数组；asset 分类 type 为 `asset_collection`。

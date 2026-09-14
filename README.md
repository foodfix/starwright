# Starwright

**Starwright** — An AI Game Master for [Ironsworn: Starforged](https://www.ironswornrpg.com): a browser-based solo RPG where an AI plays the GM, narrating the world, picking the moves, and calling the tools — while a deterministic rules engine owns **every** mechanical outcome. You play your character in free text.

**Starwright** — [Ironsworn: Starforged](https://www.ironswornrpg.com) 的 AI Game Master：一款浏览器单人 RPG，AI 扮演 GM 负责叙事与决策，规则引擎负责一切机制结算并拥有唯一权威，玩家以自由文字扮演自己的角色。

> Unofficial fan tool — not affiliated with or endorsed by Shawn Tomkin or Tomkin Press. / 非官方粉丝工具，与原作者及 Tomkin Press 无隶属或背书关系。

## Highlights / 特性

- **AI GM, engine authority** — the LLM narrates and decides, but dice, outcomes, tracks, momentum, assets and legacy all resolve inside a pure TypeScript engine (`packages/engine`). AI-visible results only. / AI 只能通过工具间接改状态；掷骰与结算由引擎执行，可注入种子复现。
- **Full rules automation** — all move categories, oracles (with nested table expansion), assets (meters, controls, attachments, enhance_moves), impacts, legacy tracks and experience. / 全量规则自动化：行动、神谕、资产、影响、遗产轨与经验。
- **Bring your own model** — any OpenAI-compatible chat completions endpoint with streaming + function calling. Your API key never leaves the browser. / 任意 OpenAI 兼容端点，用户自带 API Key，Key 不离开浏览器。
- **Bilingual UI (en/zh)** — Chinese players get pre-translated game data (`starforged.zh.json`, loaded by UI language); an AI-translate button remains as fallback. Narration language is a separate switch. / 中英双语界面：中文用户直接加载预翻译的游戏数据（`starforged.zh.json`），"AI 翻译"按钮仅作兜底；AI 叙事语言独立设置。
- **Save anywhere** — auto-save to IndexedDB, JSON export/import with version migration. / IndexedDB 自动存档，JSON 导出/导入含版本迁移链。
- **Transparent by design** — every settlement renders as an inspectable card (dice, outcome, state diff); the GM activity log shows every tool call. / 结算卡片全程可见，GM 活动面板可审计每一次工具调用。

## Getting started / 快速开始

Requirements: Node ≥ 20 and pnpm.

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

Then in the app:

1. Open **Settings** and configure your endpoint: `baseUrl`, `apiKey`, `model`. Run **Test connection** (it verifies function-calling support). / 在设置页配置 baseUrl、API Key、模型，并测试连接（会校验函数调用支持）。
2. Create a character in the wizard: pick your truths, assign stats, choose starting assets (a Starship is included). / 走新档向导：真相、属性分配、初始资产（含星际飞船）。
3. Play. Describe what you do; the GM narrates and resolves moves. / 开始游玩：描述行动，GM 叙事并结算。

Useful commands / 常用命令：

```bash
pnpm lint         # ESLint
pnpm typecheck    # tsc -b
pnpm test         # Vitest (unit + property tests)
pnpm build        # production build → apps/web/dist
```

## Architecture / 架构

```
apps/web/          React + Vite UI (wizard, narrative, character panel, GM log, settings)
packages/engine/   Pure TS rules engine — the single authority for mechanics (no DOM, no network)
packages/data/     Datasworn loader: zod validation + indexes over data/starforged.json
packages/ai/       OpenAI-compatible client (SSE + tool calls), GM agent loop, tool definitions
data/starforged.json   Datasworn 0.0.10 data (read-only, served as a static asset)
data/starforged.zh.json  Pre-translated Chinese game data (same structure, display fields only)
docs/              Development spec, engine/AI design docs, milestone acceptance records
```

See `docs/DEVELOPMENT.md` (Chinese) for the authoritative development spec, including the core invariants (INV-1…INV-4), and `docs/engine-design.md` / `docs/ai-design.md` for details.

## Deployment / 部署

The build is a fully static site (`apps/web/dist/`, includes `starforged.json` as a static asset). Any static host works — GitHub Pages, Netlify, Cloudflare Pages.

- GitHub Pages project site: build with a sub-path base, e.g. `pnpm --filter @starwright/web exec vite build --base=/starwright/`, and publish `apps/web/dist`.
- HTTPS sites calling a local Ollama endpoint must set `OLLAMA_ORIGINS` to allow browser access (CORS).
- No telemetry, no backend: the player's key stays in `localStorage` and requests go straight to their chosen endpoint.

构建产物为纯静态站点，可部署至任意静态托管；GitHub Pages 项目页需以子路径作为 base 构建（见上）。无任何遥测与后端，API Key 仅存于玩家浏览器。

## License / 许可与署名

- Code: [MIT](LICENSE) / 代码：MIT。
- Game content / 游戏内容：CC-BY 4.0.

> Attribution / 署名: This work is based on *Ironsworn: Starforged*, created by Shawn Tomkin, and licensed for our use under the [Creative Commons Attribution 4.0 International license](https://creativecommons.org/licenses/by/4.0/). Game data (moves, oracles, assets, truths) comes from the [Datasworn](https://github.com/rpgtools/datasworn) project (CC-BY 4.0). *Starwright* is an unofficial fan-made tool, not affiliated with or endorsed by Shawn Tomkin or Tomkin Press; no official art, icons or trade dress is used. / 本作品基于 Shawn Tomkin 创作的 *Ironsworn: Starforged*，依 [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可使用；游戏数据（行动、神谕、资产、真相）来自 [Datasworn](https://github.com/rpgtools/datasworn) 项目（CC-BY 4.0）。*Starwright* 为非官方粉丝工具，与 Shawn Tomkin 及 Tomkin Press 无隶属或背书关系，未使用任何官方美术、图标或装帧设计。

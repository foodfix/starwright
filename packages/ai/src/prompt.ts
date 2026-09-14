import type { Asset, OracleTreeNode, StarforgedIndex } from '@starwright/data';
import {
  assetControlInfos,
  getActiveCharacter,
  momentumMax,
  momentumReset,
  progressScore,
  type CampaignState,
  type EngineOutcome,
  type JournalEntry,
} from '@starwright/engine';

export type NarrativeLanguage = 'zh' | 'en';

export type NarrativeStyle =
  'classic' | 'concise' | 'literary' | 'humorous' | 'hardboiled' | 'custom';

type NarrativeStylePreset = Exclude<NarrativeStyle, 'custom'>;

export const NARRATIVE_STYLES: readonly NarrativeStylePreset[] = [
  'classic',
  'concise',
  'literary',
  'humorous',
  'hardboiled',
];

/** hard cap (characters) for the player-written custom style text */
export const CUSTOM_STYLE_MAX_LENGTH = 600;

const STYLE_PARAGRAPH_EN: Record<NarrativeStylePreset, string> = {
  classic:
    '2-4 tight paragraphs per turn, second person for the player. Give NPCs motives and stances.',
  concise:
    '1-2 short paragraphs per turn, second person for the player. Lead with what happens and what it costs; keep scenery to a word or two. NPCs stay distinct and motivated.',
  literary:
    "3-5 paragraphs per turn, second person for the player. Ground scenes in sensory detail and atmosphere; let the character's inner state breathe. Give NPCs motives and stances.",
  humorous:
    "2-4 paragraphs per turn in a playful, witty voice — banter with NPCs and poke fun at the ship's quirks, but never make light of a truly grave moment. Second person for the player; NPCs stay distinct and motivated.",
  hardboiled:
    '2-4 short punchy paragraphs per turn in a gritty hardboiled voice — terse sentences, hard edges, no sentimentality. Second person for the player; NPCs have motives and their own angles.',
};

const STYLE_PARAGRAPH_ZH: Record<NarrativeStylePreset, string> = {
  classic: '每回合 2–4 段紧凑叙述，对玩家使用第二人称。NPC 要有动机与立场。',
  concise:
    '每回合 1–2 短段叙述，对玩家使用第二人称。先写发生了什么、代价是什么，景物描写点到即止。NPC 保持鲜明的动机与立场。',
  literary:
    '每回合 3–5 段叙述，对玩家使用第二人称。以感官细节与氛围铺陈场景，让角色的内心有所呼吸。NPC 要有动机与立场。',
  humorous:
    '每回合 2–4 段叙述，笔调轻松诙谐——与 NPC 斗嘴、调侃飞船的小毛病，但真正沉重的时刻不打趣。对玩家使用第二人称；NPC 保持鲜明的动机与立场。',
  hardboiled:
    '每回合 2–4 个短段，冷硬派笔调——句子短促、态度干脆、不煽情。对玩家使用第二人称；NPC 有动机与立场。',
};

const GM_SPEC_EN = `You are the Game Master of a solo Ironsworn: Starforged campaign. The player speaks and acts as their single character; you portray the world: NPCs, factions, environments and consequences.

## Authority rules (absolute)
- The rules engine is the only authority for mechanics. ALL dice rolls, outcomes and state changes must go through tools. NEVER invent dice values, never declare hit/miss yourself, never write stat/meter changes into your prose.
- When a player action matches a move trigger, call make_move with the move_id and the selection its trigger demands (use get_move_detail first if unsure). make_move validates the selection and rejects an invalid one while listing the valid options — correct and retry.
- When the fiction is uncertain, call roll_oracle instead of deciding. For Ask the Oracle use make_move with oracle_id set to one of its five odds tables. When an oracle row's text references other tables via [label](id:...) links (e.g. a Story Clue row "Descriptor + Focus"), roll EACH referenced table with roll_oracle and combine them exactly as the row structures them; never re-roll the same table as a substitute.
- Outcome texts returned by tools are authoritative. Narrate the consequences they imply; if a move text grants a mechanical bonus or cost (e.g. "Take +1 momentum"), apply it with the matching tool. Asset meters change with adjust_asset_meter (companion health, vehicle integrity); raising a vehicle's integrity is impossible while battered — repair first.
- Progress discipline: when an outcome text grants "mark progress" (e.g. Strike, Clash, Gain Ground, Face Danger or Secure an Advantage in scene challenges, Undertake an Expedition, Explore a Waypoint, Develop Your Relationship, Snipe Minor Foe), apply it immediately with mark_progress on the matching track — "mark progress twice" means marks: 2 (the track's rank converts marks into ticks). For a milestone earned outside a roll (key obstacle overcome, key insight, completed expedition leg, key item or resource, significant support, notable enemy defeated), resolve reach_a_milestone (vow) or develop_your_relationship (connection) with make_move first, then mark_progress; End a Session reviews missed marks. Never leave a track at 0 after its progress was earned.
- When an outcome offers options ("Choose one"), list each option with its mechanical effect spelled out (e.g. "Take +2 momentum") and let the PLAYER pick before applying anything with tools or moving the scene forward. When the choices block is enabled, surface the pending options inside it (effects spelled out) instead of story continuations. For a delayed bonus (e.g. "+1 on your next move"), record it with set_flag and pass it as add on that future make_move call.
- The player decides whether to burn momentum (when a burn would help). Propose it and wait for their answer; only call burn_momentum after they agree.
- Assets and experience (Advance discipline): buying a new asset costs 3 experience (add_asset with pay_with_experience=true) and unlocking a second/third ability costs 2 (enable_ability with pay_with_experience=true); narrative gifts are free. Experience (XP in the snapshot) only accrues from legacy track rewards — NEVER grant assets, abilities or experience by narration. Asset-driven moves (Companion Takes a Hit, Withstand Damage) pass asset_id so the roll uses the companion's health or the vehicle's integrity; when a result lists enhancements[] (asset abilities offering adds or rerolls), tell the player and apply them with the matching tools.
- Vow and bond lifecycle: fulfill_vow rolls the vow track and awards the quests legacy reward on a hit (weak hits: ask whether to re-swear for the full reward or take one rank lower); forsake_vow clears a renounced vow (apply its cost with other tools); forge_bond rolls the connection track (weak hits need the request done first, then confirmed=true); mark_bond_decrease when a bond is lost.
- Open every game session with the begin_a_session move via make_move — including the first turn of a new campaign and the first turn after a break — then apply its effects with the matching tools (e.g. take +1 momentum via adjust_momentum).
- Content flags are set by the PLAYER (the Set a Flag session move). When the snapshot lists FLAGS, treat them as boundaries: keep that content out of the story or touch it only at a distance (reframe/refocus/replace/redirect/reshape, per Change Your Fate) instead of envisioning it in detail. Never add, alter or remove flags yourself; the scene-flag tool set_flag is unrelated to them.

## Style
- Narrate in ${'{LANGUAGE_INSTRUCTION}'}
- {STYLE_PARAGRAPH} End turns with a hook or clear situation{CYOA_TAIL}
- Use set_flag for facts you must remember, add_journal_entry for turning points, end_scene when a scene closes.`;

const GM_SPEC_ZH = `你是一场单人《Ironsworn: Starforged》战役的 GM。玩家只扮演自己的一名角色，你负责演绎整个世界：NPC、阵营、环境与后果。

## 权威规则（绝对）
- 规则引擎是一切机制的唯一权威。所有掷骰、结算与数值变化必须通过工具完成。绝不自己编造骰值、绝不自行宣布命中/失手、绝不在叙述文本里书写数值变化。
- 当玩家行动命中某个 move 的触发条件时，调用 make_move 并传入 move_id 与触发要求的选择（stat/meter/add/track_id；不确定时先用 get_move_detail 查看）。make_move 会校验选择，不合法时拒绝并列出合法项——据此修正后重试。
- 当剧情走向不确定时，调用 roll_oracle 而不是自行裁决；使用 Ask the Oracle 时以 make_move 并以 oracle_id 指定五档几率表之一。神谕行文本内经 [label](id:…) 引用的其他表（如剧情线索行的「描述词 + 焦点」）必须用 roll_oracle 逐张掷出，并严格按行结构组合成结果；不得以重掷原表替代。
- 工具返回的结局文本是权威：按其含义叙述后果；若 move 文本给予机械收益或代价（如"Take +1 momentum"），用相应工具落地；同伴/载具的计量器变化用 adjust_asset_meter（车辆 battered 期间无法提高 integrity——须先修理）。
- 进度纪律：结局文本出现"标记进度"时（如 Strike、Clash、Gain Ground、场景挑战中的 Face Danger / Secure an Advantage、Undertake an Expedition、Explore a Waypoint、Develop Your Relationship、Snipe Minor Foe），立即用 mark_progress 在对应轨落地——"标记两次进度"即 marks: 2（轨级别自动换算刻度）。掷骰之外取得里程碑式进展（克服关键障碍、获得重要洞见、完成远征段、取得关键物品或资源、赢得重要支援、击败著名敌人）时，先经 make_move 调 reach_a_milestone（vow 轨）或 develop_your_relationship（connection 轨），再 mark_progress；End a Session 时复盘补标。已挣得的进度不得让轨停留在 0。
- 当结局提供选项（"Choose one"）时，逐项列出选项并写明各自的机械效果（如"获得 +2 势头" / "下次行动 +1"），请玩家明确选择；玩家未决前不得用工具落地，也不得推进剧情。启用选项块时，须把这些待决选项纳入选项块（写明效果），而不是只给叙事后续。"on your next move" 类延迟增益用 set_flag 记录，并在那次 make_move 以 add 传入。
- 是否燃烧 momentum 由玩家决定（有助时会提出）。先提议并等待玩家答复；仅在玩家同意后调用 burn_momentum。
- 资产与经验（Advance 纪律）：买新资产 3 经验（add_asset 且 pay_with_experience=true），解锁第 2/3 ability 各 2 经验（enable_ability 且 pay_with_experience=true）；叙事馈赠免费。经验（快照 XP）只来自 legacy 奖励——绝不凭叙述给予资产、ability 或经验。同伴/载具相关 move（Companion Takes a Hit、Withstand Damage）传 asset_id 以同伴健康/载具 integrity 掷骰；结果带 enhancements[]（资产 ability 提供的加值/重掷）时先告知玩家再用匹配工具落地。
- 誓言与纽带生命周期：fulfill_vow 对誓言轨进度投并在命中时给予 quests legacy 奖励（weak hit 询问玩家重誓取全额还是降一档）；forsake_vow 弃誓清轨（用其他工具落地代价）；forge_bond 对 connection 轨进度投（weak hit 需先完成请求再以 confirmed=true 重调）；纽带失去时 mark_bond_decrease。
- 每次游戏会话开场先用 make_move 的 begin_a_session 开局——包括新战役的第一回合与暂停后继续的第一回合——再用相应工具落地其效果（如 adjust_momentum +1 momentum）。
- 内容旗标由玩家设立（Set a Flag 会话 move）。快照含 FLAGS 行时，将其视为内容边界：回避该题材，或仅以"擦过不细绘"的方式带过（Reframe/Refocus/Replace/Redirect/Reshape，见 Change Your Fate），不做细致描绘。绝不自行新增/修改/删除旗标；场景记忆工具 set_flag 与玩家旗标无关。

## 文风
- 以简体中文叙事（专有名词保留英文原文）。
- {STYLE_PARAGRAPH}回合结尾给出悬念或明确处境{CYOA_TAIL}
- 需要记住的事实用 set_flag，转折点用 add_journal_entry，场景收束时用 end_scene。`;

const CYOA_TAIL_OFF_EN = ', then append the <summary> recap block (see "Turn recap").';
const CYOA_TAIL_ON_EN =
  ', then append the <summary> recap block and the <choices> block (see below).';
const CYOA_TAIL_OFF_ZH = '，然后附上 <summary> 摘要块（见"回合摘要"）。';
const CYOA_TAIL_ON_ZH = '，然后附上 <summary> 摘要块与 <choices> 选项块（见下文）。';

const RECAP_EN = `## Turn recap
- After the closing narration of EVERY turn, append a one-line recap in this exact format (before any <choices> block):

<summary><one sentence></summary>

- The sentence states what happened this turn and how it landed (key event plus outcome direction), at most 30 words; no dice values or state numbers, no extra text inside the block.
- The interface shows it as the turn's caption and reuses it as the memory of earlier turns once they leave the context window — make each sentence self-contained.`;

const RECAP_ZH = `## 回合摘要
- 每回合收尾叙述之后，以如下确切格式追加一句话摘要（在 <choices> 块之前）：

<summary><一句话></summary>

- 这句话概括本回合发生了什么、结果落向何方（关键事件+结局方向），不超过 30 字；不含骰值等数值细节，块内不加任何多余文字。
- 界面会将其作为本回合的摘要展示，并在更早的回合离开上下文窗口后作为前情记忆复用——请让每句话自成一体。`;

const CYOA_EN = `## Player choices (CYOA)
- After the closing narration of EVERY turn, append a block of exactly 5 options for what the player could do next, as the very last thing in your final text, in this exact format:

<choices>
1. <option> [Move name]
2. <option> [story]
3. <option> [Move name]
4. <option> [Move name]
5. <option> [story]
</choices>

- Each option is a single concrete, actionable line written from the player character's perspective, at most 20 words (excluding the tag), and the five differ in kind (act, investigate, talk, recover/regroup, unconventional).
- Every option line ends with a bracketed tag: if acting on the option would resolve a move, tag it with that move's name in English (e.g. [Face Danger], [Compel], [Enter the Fray]); if it advances the fiction without mechanics, tag it [story]. Tag pending "Choose one" options with the move that produced them (their mechanical effects stay spelled out).
- When a just-resolved outcome left a choice pending ("Choose one"), the block must carry those pending options with their mechanical effects spelled out (e.g. "1. Take +2 momentum [Endure Harm]"), not story continuations.
- No extra text, lists or explanations inside the block. The interface renders the options as buttons with the tag as a badge; the player may still type a completely different action.`;

const CYOA_ZH = `## 玩家选项（CYOA）
- 每回合收尾叙述之后，以如下确切格式追加恰好 5 个玩家下一步可选行动，作为最终文本的最后内容：

<choices>
1. <选项> [Move 名]
2. <选项> [剧情]
3. <选项> [Move 名]
4. <选项> [Move 名]
5. <选项> [剧情]
</choices>

- 每个选项一行，从玩家角色的视角写出具体可执行的行动，不超过 20 字（不含标记），五个选项类型互不雷同（行动、调查、交涉、恢复/整顿、非常规）。
- 每个选项行尾附一个方括号标记：选取该选项将触发某个 move 时，标记写该 move 名（专有名词保留英文原文，如 [Face Danger]、[Compel]、[Enter the Fray]）；纯推进剧情、不涉机制的选项标记 [剧情]。刚结算结局的待决选项以产生它的 move 名标记（机械效果仍须写明）。
- 若刚结算的结局尚有待玩家选择的选项（"Choose one"），选项块必须收录这些待决选项并写明机械效果（如"1. 获得 +2 势头 [Endure Harm]"），而不是只给叙事后续。
- 块内不加任何多余文字、列表或说明。界面会将选项渲染为按钮并展示标记徽标；玩家仍可自行输入完全不同的行动。`;

function languageInstruction(language: NarrativeLanguage): string {
  return language === 'zh' ? 'Simplified Chinese (keep proper nouns in English).' : 'English.';
}

/** style-specific "Style" bullet; unknown values fall back to classic */
function styleParagraph(
  language: NarrativeLanguage,
  style: NarrativeStyle,
  customStyle?: string,
): string {
  if (style === 'custom') {
    const text = (customStyle ?? '').replace(/\s+/g, ' ').trim();
    if (text.length === 0) return styleParagraph(language, 'classic');
    return text.slice(0, CUSTOM_STYLE_MAX_LENGTH);
  }
  const table = language === 'zh' ? STYLE_PARAGRAPH_ZH : STYLE_PARAGRAPH_EN;
  return table[NARRATIVE_STYLES.includes(style as NarrativeStylePreset) ? style : 'classic'];
}

export function gmSpec(
  language: NarrativeLanguage,
  cyoa = false,
  style: NarrativeStyle = 'classic',
  customStyle?: string,
): string {
  const spec = language === 'zh' ? GM_SPEC_ZH : GM_SPEC_EN;
  const tail =
    language === 'zh'
      ? cyoa
        ? CYOA_TAIL_ON_ZH
        : CYOA_TAIL_OFF_ZH
      : cyoa
        ? CYOA_TAIL_ON_EN
        : CYOA_TAIL_OFF_EN;
  const base = spec
    .replace('{LANGUAGE_INSTRUCTION}', languageInstruction(language))
    .replace('{STYLE_PARAGRAPH}', styleParagraph(language, style, customStyle))
    .replace('{CYOA_TAIL}', tail);
  const recap = language === 'zh' ? RECAP_ZH : RECAP_EN;
  if (!cyoa) return `${base}\n\n${recap}`;
  return `${base}\n\n${recap}\n\n${language === 'zh' ? CYOA_ZH : CYOA_EN}`;
}

const STAT_ORDER = ['edge', 'heart', 'iron', 'shadow', 'wits'] as const;
const METER_ORDER = ['health', 'spirit', 'supply'] as const;

function sign(n: number): string {
  return n >= 0 ? `+${String(n)}` : String(n);
}

function truthKey(truthId: string): string {
  return truthId.split('/').pop() ?? truthId;
}

function truthLines(state: CampaignState, index: StarforgedIndex): string[] {
  const lines: string[] = [];
  for (const truth of index.listTruths()) {
    const optionIndex = state.truths[truthKey(truth._id)];
    if (optionIndex === undefined) continue;
    const option = truth.options[Number(optionIndex)];
    if (!option) continue;
    lines.push(`- ${truth.name}: ${option.summary}`);
  }
  return lines;
}

function assetLine(
  asset: NonNullable<CampaignState['assets'][number]>,
  index: StarforgedIndex,
): string {
  const def: Asset | undefined = index.getAsset(asset.assetId);
  const name = def?.name ?? asset.assetId;
  const parts = [asset.id, asset.assetId, name, `abilities ${asset.enabledAbilities.length}/3`];
  const meters = Object.entries(asset.meters);
  if (meters.length > 0) {
    parts.push(
      `meters: ${meters
        .map(([key, value]) => {
          const info = def ? assetControlInfos(def).get(key) : undefined;
          return info?.max !== undefined ? `${key} ${value}/${info.max}` : `${key} ${value}`;
        })
        .join(', ')}`,
    );
  }
  const activeControls = Object.entries(asset.controls)
    .filter(([, value]) => value === true)
    .map(([key]) => key);
  if (activeControls.length > 0) parts.push(`controls: ${activeControls.join(', ')}`);
  if (asset.attachedTo !== undefined) parts.push(`attached: ${asset.attachedTo}`);
  return parts.join(' | ');
}

function outcomeSummary(outcome: EngineOutcome): string {
  switch (outcome.kind) {
    case 'action_roll':
      return `action_roll ${outcome.outcome} score ${outcome.score} vs ${outcome.dice.challenge.join('/')}${outcome.burned ? ' (burned)' : ''}`;
    case 'progress_roll':
      return `progress_roll ${outcome.outcome} score ${outcome.score} vs ${outcome.dice.challenge.join('/')} (${outcome.trackId})`;
    case 'burn_momentum':
      return `burn_momentum ${outcome.result.outcome} score ${outcome.result.score} (momentum ${sign(outcome.momentumBefore)}→${sign(outcome.momentumAfter)})`;
    case 'adjust_momentum':
      return `momentum ${sign(outcome.delta)} (${outcome.before}→${outcome.after}, max ${outcome.momentumMax})`;
    case 'adjust_meter':
      return `${outcome.meter} ${sign(outcome.delta)} (${outcome.before}→${outcome.after})`;
    case 'mark_impact':
      return `impact marked: ${outcome.impactId}`;
    case 'clear_impact':
      return `impact cleared: ${outcome.impactId}`;
    case 'add_track':
      return `track created ${outcome.trackId} "${outcome.title}" (${outcome.rank ?? 'no rank'})`;
    case 'mark_progress':
      return `progress ${outcome.trackId} +${outcome.ticksAdded} ticks (${outcome.ticks}/40)`;
    case 'adjust_legacy':
      return `legacy ${outcome.legacy} ${sign(outcome.ticksAdded)} ticks (${outcome.ticks}/40${outcome.cleared ? ', cleared' : ''})${outcome.experienceGained > 0 ? ` +${outcome.experienceGained} XP` : ''}`;
    case 'add_asset':
      return `asset gained: ${outcome.asset.name} (${outcome.asset.instanceId})${outcome.experienceCost > 0 ? ` -${outcome.experienceCost} XP` : ''}`;
    case 'discard_asset':
      return `asset discarded: ${outcome.asset.name} (${outcome.asset.instanceId})`;
    case 'enable_ability':
      return `ability ${outcome.abilityIndex} enabled on ${outcome.asset.name}${outcome.experienceCost > 0 ? ` -${outcome.experienceCost} XP` : ''}`;
    case 'adjust_asset_meter':
      return `asset ${outcome.asset.name} ${outcome.control} ${sign(outcome.delta)} (${outcome.before}→${outcome.after})`;
    case 'set_asset_control':
      return `asset ${outcome.asset.name} ${outcome.control} = ${outcome.value}`;
    case 'remove_track':
      return `track removed: ${outcome.trackId} "${outcome.title}"`;
    case 'update_track': {
      const changes: string[] = [];
      if (outcome.rankBefore !== undefined && outcome.rankBefore !== outcome.rank) {
        changes.push(`rank ${outcome.rankBefore ?? 'none'}→${outcome.rank}`);
      }
      if (outcome.ticksBefore !== undefined && outcome.ticksBefore !== outcome.ticks) {
        changes.push(`ticks ${outcome.ticksBefore}→${outcome.ticks}`);
      }
      return `track updated ${outcome.trackId} (${changes.join(', ') || 'renamed'})`;
    }
    case 'set_flag':
      return `flag ${outcome.key}=${JSON.stringify(outcome.value)}`;
    case 'add_journal_entry':
      return 'note added';
    case 'set_aboard_vehicle':
      return `aboard vehicles: ${outcome.assetIds.join(', ') || 'none'}`;
    case 'end_scene':
      return `scene ${outcome.sceneIndex} begins`;
  }
}

function journalLine(entry: JournalEntry): string {
  if (entry.kind === 'note') {
    const text = (entry.note ?? '').replace(/\s+/g, ' ').slice(0, 120);
    return `- note: ${text}`;
  }
  return `- ${outcomeSummary(entry.outcome as EngineOutcome)}`;
}

export interface SnapshotOptions {
  journalEntries?: number;
}

export function buildSnapshot(
  state: CampaignState,
  index: StarforgedIndex,
  options: SnapshotOptions = {},
): string {
  const character = getActiveCharacter(state);
  const stats = STAT_ORDER.map((id) => `${id} ${character.stats[id]}`).join(' ');
  const meters = METER_ORDER.map((id) => `${id} ${character.meters[id]}/5`).join(' ');
  const impacts =
    character.impacts.length > 0 ? character.impacts.map((i) => i.impactId).join(', ') : 'none';
  const lines: string[] = [];
  lines.push(
    `CHARACTER ${character.name} | stats: ${stats} | meters: ${meters} | momentum ${sign(state.momentum)} (max ${momentumMax(state, index)}, reset ${momentumReset(state, index)}) | impacts: ${impacts} | XP ${state.experience}`,
  );
  const background = character.background.trim();
  if (background.length > 0) {
    lines.push(
      `BACKGROUND (player-written backstory — treat as canon): ${background.replace(/\s+/g, ' ')}`,
    );
  }
  const canonLines = truthLines(state, index);
  if (canonLines.length > 0) {
    lines.push('TRUTHS (world canon established at campaign start — treat as canon):');
    lines.push(...canonLines);
  }
  if (state.contentFlags.length > 0) {
    lines.push(
      `FLAGS (player-set content boundaries — omit or only touch at a distance, see Set a Flag): ${state.contentFlags.join(' ;; ')}`,
    );
  }
  if (state.assets.length > 0) {
    lines.push(`ASSETS: ${state.assets.map((asset) => assetLine(asset, index)).join(' ;; ')}`);
  }
  const trackIds = Object.keys(state.tracks);
  if (trackIds.length > 0) {
    lines.push('TRACKS (id | title | rank | progress):');
    for (const id of trackIds) {
      const track = state.tracks[id];
      if (!track) continue;
      lines.push(
        `- ${id} | ${track.title} | ${track.rank ?? 'none'} | ${track.ticks}/40 [${progressScore(track.ticks)} boxes] (${track.kind})`,
      );
    }
  } else {
    lines.push('TRACKS: none');
  }
  const legacy = ['quests_legacy', 'bonds_legacy', 'discoveries_legacy'] as const;
  lines.push(
    `LEGACY: ${legacy
      .map((id) => {
        const track = state.legacy[id];
        return `${id.replace('_legacy', '')} ${track.ticks}/40${track.cleared ? ' (cleared: rolls as 10, 1 XP/box)' : ''}`;
      })
      .join(' | ')}`,
  );
  const flagKeys = Object.keys(state.scene.flags);
  lines.push(
    `SCENE ${state.scene.index} | flags: ${flagKeys.length > 0 ? flagKeys.map((k) => `${k}=${JSON.stringify(state.scene.flags[k])}`).join(', ') : 'none'}`,
  );
  const count = options.journalEntries ?? 8;
  const recent = state.journal.slice(-count);
  if (recent.length > 0) {
    lines.push('RECENT JOURNAL:');
    for (const entry of recent) lines.push(journalLine(entry));
  }
  return lines.join('\n');
}

export function buildMoveCatalog(index: StarforgedIndex): string {
  const lines: string[] = ['MOVE CATALOG (id | name | roll_type):'];
  for (const category of index.listMoves()) {
    lines.push(`## ${category.name}`);
    for (const move of category.moves) {
      lines.push(`${move.id} | ${move.name} | ${move.rollType}`);
    }
  }
  return lines.join('\n');
}

export function buildOracleCatalog(index: StarforgedIndex): string {
  const lines: string[] = ['ORACLE CATALOG (id | name | path):'];
  const walk = (nodes: readonly OracleTreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'collection') {
        walk(node.contents);
        continue;
      }
      lines.push(`${node.id} | ${node.name} | ${node.breadcrumbs.join(' > ')}`);
    }
  };
  walk(index.listOracleTree());
  return lines.join('\n');
}

export interface SystemPromptOptions {
  /** append the CYOA choices-block instruction to the GM spec */
  cyoa?: boolean;
  /** narrative style preset for the GM spec "Style" section (default classic) */
  style?: NarrativeStyle;
  /** player-written style text, injected when style is 'custom' (falls back to classic when blank) */
  customStyle?: string;
}

export function buildSystemPrompt(
  state: CampaignState,
  index: StarforgedIndex,
  language: NarrativeLanguage = 'en',
  options: SystemPromptOptions = {},
): string {
  return [
    gmSpec(language, options.cyoa === true, options.style ?? 'classic', options.customStyle),
    '## CURRENT STATE',
    buildSnapshot(state, index),
    '## ' + buildMoveCatalog(index),
    '## ' + buildOracleCatalog(index),
  ].join('\n\n');
}

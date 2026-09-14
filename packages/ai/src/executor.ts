import type { ConditionMeterId, OracleRollable, StatId, StarforgedIndex } from '@starwright/data';
import {
  legacyRewardTicks,
  listEnhancements,
  meterControlInfo,
  rollOracle,
  assetDisabled,
  instanceMatchesAssetPatterns,
  type AssetInstance,
  type CampaignState,
  type ChallengeRank,
  type EngineEvent,
  type JsonValue,
  type OracleResult,
  type ReduceResult,
  type Rng,
  type TrackKind,
  reduce,
} from '@starwright/engine';
import { parseToolArguments } from './args.js';

export interface ExecutorContext {
  index: StarforgedIndex;
  rng: Rng;
  getState(): CampaignState;
  replaceState(state: CampaignState): void;
}

export interface ToolErrorShape {
  code: string;
  message: string;
  hint?: string;
}

export type ToolExecution = { ok: true; payload: unknown } | { ok: false; error: ToolErrorShape };

interface ParsedArgs {
  [key: string]: unknown;
}

function parseArgs(argumentsJson: string): ParsedArgs | ToolErrorShape {
  const parsed = parseToolArguments(argumentsJson);
  if ('code' in parsed && typeof parsed.code === 'string' && typeof parsed.message === 'string') {
    return parsed as ToolErrorShape;
  }
  return parsed as ParsedArgs;
}

function str(args: ParsedArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

function int(args: ParsedArgs, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function reduceEvent(
  ctx: ExecutorContext,
  event: EngineEvent,
): { execution: ToolExecution; reduceResult?: ReduceResult } {
  const current = ctx.getState();
  const result = reduce(current, event, ctx);
  if (result.ok) {
    ctx.replaceState(result.state);
    return { execution: { ok: true, payload: result.outcome }, reduceResult: result };
  }
  const error: ToolErrorShape = result.error.hint
    ? { code: result.error.code, message: result.error.message, hint: result.error.hint }
    : { code: result.error.code, message: result.error.message };
  return { execution: { ok: false, error }, reduceResult: result };
}

const TABLE_MARKER = /\{\{table:([^}]+)\}\}/g;

/** exact reference test: {{table:<id>}} for one specific oracle id */
function referencesTable(text: string | undefined, tableId: string): boolean {
  if (!text) return false;
  const re = new RegExp(`\\{\\{table:${tableId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`);
  return re.test(text);
}

interface MoveOutcomeTexts {
  strong_hit?: { text: string };
  weak_hit?: { text: string };
  miss?: { text: string };
}

interface MoveNodeShape {
  _id: string;
  name: string;
  roll_type: string;
  trigger?: unknown;
  text?: string;
  outcomes?: MoveOutcomeTexts | null;
  oracles?: string[];
}

interface RollOptionShape {
  using: string;
  stat?: string;
  condition_meter?: string;
  control?: string;
  assets?: string[] | null;
  value?: number;
  label?: string;
}

interface TriggerShape {
  conditions?: Array<{
    method?: string | null;
    roll_options?: RollOptionShape[] | null;
  }> | null;
}

function outcomeTexts(outcomes: MoveOutcomeTexts | null | undefined): MoveOutcomeTexts {
  return outcomes ?? {};
}

/**
 * Roll every `{{table:<oracle_id>}}` reference inside move outcome text and
 * substitute the rolled row text. Uses the same engine oracle roller (INV-2).
 */
function expandMoveText(
  text: string,
  ctx: ExecutorContext,
): { text: string; nested: OracleResult[] } {
  const nested: OracleResult[] = [];
  const expanded = text.replace(TABLE_MARKER, (_full, ref: string) => {
    const rolled = rollOracle(ref.trim(), ctx);
    nested.push(rolled);
    return rolled.text;
  });
  return { text: expanded, nested };
}

interface ResolvedSelection {
  stat?: StatId;
  meter?: ConditionMeterId;
  assetMeter?: { assetId: string; control: string };
  add?: number;
  /** human-readable note about auto-resolved selections */
  note?: string;
}

interface AssetControlOption {
  control: string;
  assets: string[] | null;
  attachedOnly: boolean;
}

interface TriggerInfo {
  stats: StatId[];
  meters: ConditionMeterId[];
  customs: Array<{ value: number; label?: string }>;
  legacyTracks: string[];
  progressTrack: boolean;
  assetControls: AssetControlOption[];
  autoMethods: Array<'highest' | 'lowest'>;
  /** true when trigger mixes auto (highest/lowest) and player_choice conditions */
  mixedMethods: boolean;
}

function triggerInfo(move: MoveNodeShape): TriggerInfo {
  const info: TriggerInfo = {
    stats: [],
    meters: [],
    customs: [],
    legacyTracks: [],
    progressTrack: false,
    assetControls: [],
    autoMethods: [],
    mixedMethods: false,
  };
  const trigger = move.trigger as TriggerShape | null | undefined;
  const conditions = trigger?.conditions ?? [];
  const hasAuto = conditions.some((c) => c.method === 'highest' || c.method === 'lowest');
  const hasOther = conditions.some((c) => c.method !== 'highest' && c.method !== 'lowest');
  info.mixedMethods = hasAuto && hasOther;
  for (const condition of conditions) {
    if (condition.method === 'highest' || condition.method === 'lowest') {
      info.autoMethods.push(condition.method);
    }
    for (const option of condition.roll_options ?? []) {
      switch (option.using) {
        case 'stat':
          if (option.stat && !info.stats.includes(option.stat as StatId)) {
            info.stats.push(option.stat as StatId);
          }
          break;
        case 'condition_meter':
          if (
            option.condition_meter &&
            !info.meters.includes(option.condition_meter as ConditionMeterId)
          ) {
            info.meters.push(option.condition_meter as ConditionMeterId);
          }
          break;
        case 'custom':
          if (option.value !== undefined) {
            info.customs.push({ value: option.value, label: option.label });
          }
          break;
        case 'progress_track':
          info.progressTrack = true;
          break;
        case 'asset_control':
          info.assetControls.push({
            control: option.control ?? '',
            assets: option.assets ?? null,
            attachedOnly: false,
          });
          break;
        case 'attached_asset_control':
          info.assetControls.push({
            control: option.control ?? '',
            assets: null,
            attachedOnly: true,
          });
          break;
        default:
          if (option.using.endsWith('_legacy') && !info.legacyTracks.includes(option.using)) {
            info.legacyTracks.push(option.using);
          }
          break;
      }
    }
  }
  return info;
}

function labeledOptions(info: TriggerInfo): string[] {
  const labels: string[] = [];
  for (const stat of info.stats) labels.push(`stat:${stat}`);
  for (const meter of info.meters) labels.push(`meter:${meter}`);
  for (const custom of info.customs) {
    labels.push(`add:${custom.value}${custom.label ? ` (${custom.label})` : ''}`);
  }
  for (const legacy of info.legacyTracks) labels.push(`track:${legacy}`);
  if (info.progressTrack) labels.push('track_id: a progress track id');
  return labels;
}

/** auto-pick highest/lowest stat or meter from the current character state */
function autoPickSelection(info: TriggerInfo, state: CampaignState): ResolvedSelection | undefined {
  if (info.autoMethods.length === 0 || info.mixedMethods) return undefined;
  const method = info.autoMethods[0];
  if (!method) return undefined;
  const character = state.characters.find((c) => c.id === state.activeCharacterId);
  if (!character) return undefined;
  const candidates: Array<{ kind: 'stat' | 'meter'; id: string; value: number }> = [];
  for (const stat of info.stats) {
    const value = character.stats[stat];
    if (typeof value === 'number') candidates.push({ kind: 'stat', id: stat, value });
  }
  for (const meter of info.meters) {
    const value = character.meters[meter];
    if (typeof value === 'number') candidates.push({ kind: 'meter', id: meter, value });
  }
  if (candidates.length === 0) return undefined;
  const best = candidates.reduce((a, b) =>
    method === 'highest' ? (b.value > a.value ? b : a) : b.value < a.value ? b : a,
  );
  const note = `${method}(${best.id})=${best.value}`;
  return best.kind === 'stat'
    ? { stat: best.id as StatId, note }
    : { meter: best.id as ConditionMeterId, note };
}

/** owned instances that can serve an asset_control trigger of this move */
function assetControlCandidates(
  state: CampaignState,
  index: StarforgedIndex,
  info: TriggerInfo,
): AssetInstance[] {
  const hosts = new Set(
    state.assets.filter((a) => a.attachedTo !== undefined).map((a) => a.attachedTo as string),
  );
  return state.assets.filter((instance) => {
    const def = index.getAsset(instance.assetId);
    if (!def || assetDisabled(instance, index)) return false;
    return info.assetControls.some((wanted) => {
      try {
        meterControlInfo(def, wanted.control);
      } catch {
        return false;
      }
      if (!instanceMatchesAssetPatterns(instance, wanted.assets)) return false;
      if (wanted.attachedOnly && !hosts.has(instance.id)) return false;
      return true;
    });
  });
}

/**
 * Validate the roll selection of a move call against its trigger options.
 * Returns either a resolved selection or a structured error for self-correction.
 */
function resolveSelection(
  move: MoveNodeShape,
  args: ParsedArgs,
  state: CampaignState,
  index: StarforgedIndex,
): ResolvedSelection | ToolErrorShape {
  const info = triggerInfo(move);
  if (info.assetControls.length > 0) {
    const control = info.assetControls[0]!.control;
    const assetIdArg = str(args, 'asset_id');
    const candidates = assetControlCandidates(state, index, info);
    if (assetIdArg !== undefined) {
      const instance = candidates.find((c) => c.id === assetIdArg);
      if (!instance) {
        const owned = state.assets.find((a) => a.id === assetIdArg);
        if (owned) {
          return {
            code: 'invalid_roll_selection',
            message: `asset instance "${assetIdArg}" cannot roll +${control} for move "${move._id}"`,
            hint:
              candidates.length > 0
                ? `valid instances: ${candidates.map((c) => c.id).join(', ')}`
                : `no owned asset currently provides +${control}`,
          };
        }
        return {
          code: 'unknown_asset',
          message: `asset instance "${assetIdArg}" not found`,
          hint: 'use an instance id from the ASSETS snapshot line',
        };
      }
      return { assetMeter: { assetId: instance.id, control } };
    }
    if (candidates.length === 1) {
      const only = candidates[0]!;
      return {
        assetMeter: { assetId: only.id, control },
        note: `asset:${only.id}(${control})`,
      };
    }
    if (candidates.length === 0) {
      return {
        code: 'asset_control_no_asset',
        message: `move "${move._id}" rolls with an asset meter (+${control}) but no owned asset provides it`,
        hint: 'acquire the matching asset first (add_asset), or resolve the outcome narratively',
      };
    }
    return {
      code: 'asset_control_ambiguous',
      message: `several owned assets can roll +${control} for move "${move._id}"`,
      hint: `pass asset_id: one of ${candidates.map((c) => c.id).join(', ')}`,
    };
  }
  const stat = str(args, 'stat') as StatId | undefined;
  const meter = str(args, 'meter') as ConditionMeterId | undefined;
  const add = int(args, 'add');
  const selection: ResolvedSelection = {};
  if (stat !== undefined) {
    if (info.stats.length > 0 && !info.stats.includes(stat)) {
      return {
        code: 'invalid_roll_selection',
        message: `move "${move._id}" cannot be rolled with stat "${stat}"`,
        hint: `valid selections: ${labeledOptions(info).join(', ')}`,
      };
    }
    selection.stat = stat;
  }
  if (meter !== undefined) {
    if (info.meters.length > 0 && !info.meters.includes(meter)) {
      return {
        code: 'invalid_roll_selection',
        message: `move "${move._id}" cannot be rolled with meter "${meter}"`,
        hint: `valid selections: ${labeledOptions(info).join(', ')}`,
      };
    }
    selection.meter = meter;
  }
  if (add !== undefined) {
    if (info.customs.length > 0 && !info.customs.some((custom) => custom.value === add)) {
      return {
        code: 'invalid_roll_selection',
        message: `move "${move._id}" does not accept add ${add}`,
        hint: `valid adds: ${info.customs
          .map((custom) => `${custom.value}${custom.label ? ` (${custom.label})` : ''}`)
          .join(', ')}`,
      };
    }
    selection.add = add;
  }
  if (selection.stat === undefined && selection.meter === undefined) {
    const auto = autoPickSelection(info, state);
    if (auto) return auto;
    const needsChoice =
      info.stats.length + info.meters.length > 0 || (info.customs.length > 0 && add === undefined);
    if (needsChoice && move.roll_type === 'action_roll') {
      return {
        code: 'roll_selection_required',
        message: `move "${move._id}" requires a roll selection`,
        hint: `valid selections: ${labeledOptions(info).join(', ')}`,
      };
    }
  }
  return selection;
}

/** handle move.oracles: explicit oracle_id, single auto-roll, or candidate list */
function embeddedOracleOutcome(
  move: MoveNodeShape,
  rawText: string | undefined,
  rawOutcomes: string[],
  ctx: ExecutorContext,
  args: ParsedArgs,
): { rolls?: OracleResult[]; candidates?: string[]; error?: ToolErrorShape } {
  const listed = move.oracles ?? [];
  if (listed.length === 0) return {};
  const referenced = listed.filter(
    (id) => referencesTable(rawText, id) || rawOutcomes.some((text) => referencesTable(text, id)),
  );
  const oracleId = str(args, 'oracle_id');
  const rolls: OracleResult[] = [];
  if (oracleId !== undefined) {
    if (!listed.includes(oracleId)) {
      return {
        error: {
          code: 'invalid_input',
          message: `oracle_id "${oracleId}" is not part of move "${move._id}"`,
          hint: `valid oracle ids: ${listed.join(', ')}`,
        },
      };
    }
    // explicit choice wins; no candidate list needed
    rolls.push(rollOracle(oracleId, ctx));
    return { rolls };
  }
  const remaining = listed.filter((id) => !referenced.includes(id));
  if (remaining.length === 1) {
    const only = remaining[0];
    if (only) rolls.push(rollOracle(only, ctx));
    return { rolls: rolls.length > 0 ? rolls : undefined };
  }
  if (remaining.length > 1) {
    return { candidates: remaining };
  }
  return {};
}

function oracleRollSummary(
  rolls: OracleResult[],
): Array<{ tableId: string; roll: number; text: string }> {
  return rolls.map((roll) => ({ tableId: roll.tableId, roll: roll.roll, text: roll.text }));
}

const SPECIAL_TRACK_LEGACY_ROLLS: Record<string, string[]> = {
  'starforged/moves/threshold/overcome_destruction': ['bonds_legacy'],
  'starforged/moves/legacy/continue_a_legacy': [
    'quests_legacy',
    'bonds_legacy',
    'discoveries_legacy',
  ],
  'starforged/assets/deed/vanguard/abilities/0/moves/seek_safe_haven': ['discoveries_legacy'],
};

function enhancementsFor(ctx: ExecutorContext, moveId: string): unknown[] | undefined {
  const enhancements = listEnhancements(ctx.getState(), ctx.index, moveId);
  return enhancements.length > 0 ? enhancements : undefined;
}

function makeMove(ctx: ExecutorContext, args: ParsedArgs): ToolExecution {
  const moveId = str(args, 'move_id');
  if (moveId === undefined) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: 'move_id is required',
        hint: 'pick a move_id from the catalog, e.g. starforged/moves/adventure/face_danger',
      },
    };
  }
  const move = ctx.index.getMove(moveId);
  if (!move) {
    return {
      ok: false,
      error: {
        code: 'unknown_move',
        message: `move "${moveId}" not found`,
        hint: 'use an id from the move catalog in the system prompt',
      },
    };
  }
  const node = move as unknown as MoveNodeShape;
  const add = int(args, 'add');

  // special_track moves roll against legacy tracks (Overcome Destruction vs
  // bonds; Continue a Legacy against each of the three). The engine's
  // progress_roll accepts legacy track ids (engine-design §3.2).
  if (node.roll_type === 'special_track') {
    const tracks = SPECIAL_TRACK_LEGACY_ROLLS[node._id];
    if (!tracks) {
      return {
        ok: false,
        error: {
          code: 'unsupported_move_type',
          message: `move "${node._id}" uses roll_type "special_track" without a known legacy track mapping`,
          hint: 'resolve it narratively; report this mapping gap',
        },
      };
    }
    const rolls: Array<{ legacy: string; outcomeKind: string; engineOutcome: unknown }> = [];
    for (const legacy of tracks) {
      const { execution, reduceResult } = reduceEvent(ctx, {
        type: 'progress_roll',
        trackId: legacy,
      });
      if (!execution.ok || !reduceResult?.ok) return execution;
      const outcome = reduceResult.outcome;
      if (outcome.kind !== 'progress_roll') return execution;
      rolls.push({ legacy, outcomeKind: outcome.outcome, engineOutcome: outcome });
    }
    const outcomeRawTexts = rolls.map((roll) => {
      const byKind = outcomeTexts(node.outcomes);
      const key = roll.outcomeKind as keyof MoveOutcomeTexts;
      return byKind[key]?.text ?? '';
    });
    const embedded = embeddedOracleOutcome(node, node.text, outcomeRawTexts, ctx, args);
    if (embedded.error) return { ok: false, error: embedded.error };
    const single = rolls.length === 1 ? rolls[0] : undefined;
    let text: string | undefined;
    let nested: OracleResult[] = [];
    if (single) {
      const raw = outcomeRawTexts[0] ?? '';
      if (raw) {
        const expanded = expandMoveText(raw, ctx);
        text = expanded.text;
        nested = expanded.nested;
      }
    }
    return {
      ok: true,
      payload: {
        move: { id: node._id, name: node.name, roll_type: node.roll_type },
        ...(single ? { outcomeKind: single.outcomeKind, engineOutcome: single.engineOutcome } : {}),
        rolls: single ? undefined : rolls,
        text: text ?? node.text ?? '',
        nestedOracleRolls: nested.length > 0 ? nested : undefined,
        oracleRolls: embedded.rolls ? oracleRollSummary(embedded.rolls) : undefined,
        oracleCandidates: embedded.candidates,
        enhancements: enhancementsFor(ctx, node._id),
      },
    };
  }

  switch (node.roll_type) {
    case 'action_roll': {
      const selection = resolveSelection(node, args, ctx.getState(), ctx.index);
      if ('code' in selection && 'message' in selection) {
        return { ok: false, error: selection as ToolErrorShape };
      }
      const resolved = selection as ResolvedSelection;
      const { execution, reduceResult } = reduceEvent(ctx, {
        type: 'action_roll',
        stat: resolved.stat,
        meter: resolved.meter,
        assetMeter: resolved.assetMeter,
        add: resolved.add ?? add,
      });
      if (!execution.ok || !reduceResult?.ok) return execution;
      const outcome = reduceResult.outcome;
      if (outcome.kind !== 'action_roll') return execution;
      const kind = outcome.outcome;
      const raw = outcomeTexts(node.outcomes)[kind]?.text;
      const expanded = raw ? expandMoveText(raw, ctx) : { text: undefined, nested: [] };
      const embedded = embeddedOracleOutcome(node, node.text, [raw ?? ''], ctx, args);
      if (embedded.error) return { ok: false, error: embedded.error };
      return {
        ok: true,
        payload: {
          move: { id: node._id, name: node.name, roll_type: node.roll_type },
          outcomeKind: kind,
          engineOutcome: outcome,
          text: expanded.text,
          nestedOracleRolls: expanded.nested.length > 0 ? expanded.nested : undefined,
          oracleRolls: embedded.rolls ? oracleRollSummary(embedded.rolls) : undefined,
          oracleCandidates: embedded.candidates,
          selection: resolved.note,
          enhancements: enhancementsFor(ctx, node._id),
        },
      };
    }
    case 'progress_roll': {
      const trackId = str(args, 'track_id');
      if (trackId === undefined) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message: `progress-roll move "${moveId}" requires track_id`,
            hint: 'pass the track id to roll against (create it first with add_track/swear_vow)',
          },
        };
      }
      const { execution, reduceResult } = reduceEvent(ctx, {
        type: 'progress_roll',
        trackId,
      });
      if (!execution.ok || !reduceResult?.ok) return execution;
      const outcome = reduceResult.outcome;
      if (outcome.kind !== 'progress_roll') return execution;
      const kind = outcome.outcome;
      const raw = outcomeTexts(node.outcomes)[kind]?.text;
      const expanded = raw ? expandMoveText(raw, ctx) : { text: undefined, nested: [] };
      const embedded = embeddedOracleOutcome(node, node.text, [raw ?? ''], ctx, args);
      if (embedded.error) return { ok: false, error: embedded.error };
      return {
        ok: true,
        payload: {
          move: { id: node._id, name: node.name, roll_type: node.roll_type },
          outcomeKind: kind,
          engineOutcome: outcome,
          text: expanded.text,
          nestedOracleRolls: expanded.nested.length > 0 ? expanded.nested : undefined,
          oracleRolls: embedded.rolls ? oracleRollSummary(embedded.rolls) : undefined,
          oracleCandidates: embedded.candidates,
          enhancements: enhancementsFor(ctx, node._id),
        },
      };
    }
    case 'no_roll': {
      const raw = node.text ?? outcomeTexts(node.outcomes).strong_hit?.text ?? '';
      const expanded = raw ? expandMoveText(raw, ctx) : { text: '', nested: [] };
      const embedded = embeddedOracleOutcome(node, node.text, [raw], ctx, args);
      if (embedded.error) return { ok: false, error: embedded.error };
      return {
        ok: true,
        payload: {
          move: { id: node._id, name: node.name, roll_type: node.roll_type },
          text: expanded.text,
          nestedOracleRolls: expanded.nested.length > 0 ? expanded.nested : undefined,
          oracleRolls: embedded.rolls ? oracleRollSummary(embedded.rolls) : undefined,
          oracleCandidates: embedded.candidates,
          enhancements: enhancementsFor(ctx, node._id),
          note: 'This move involves no roll; narrate the outcome within the rules of the move.',
        },
      };
    }
    default:
      return {
        ok: false,
        error: {
          code: 'unsupported_move_type',
          message: `move "${moveId}" uses roll_type "${node.roll_type}" which is not automated`,
          hint: 'resolve it narratively for now',
        },
      };
  }
}

function moveDetail(ctx: ExecutorContext, args: ParsedArgs): ToolExecution {
  const moveId = str(args, 'move_id');
  const move = moveId ? ctx.index.getMove(moveId) : undefined;
  if (!move) {
    return {
      ok: false,
      error: {
        code: 'unknown_move',
        message: `move "${moveId ?? ''}" not found`,
        hint: 'use an id from the move catalog in the system prompt',
      },
    };
  }
  const node = move as unknown as MoveNodeShape;
  return {
    ok: true,
    payload: {
      id: node._id,
      name: node.name,
      roll_type: node.roll_type,
      trigger: node.trigger ?? undefined,
      text: node.text,
      outcomes: node.outcomes ?? undefined,
      oracles: node.oracles,
    },
  };
}

function oracleDetail(ctx: ExecutorContext, args: ParsedArgs): ToolExecution {
  const tableId = str(args, 'table_id');
  const table = tableId ? ctx.index.getOracle(tableId) : undefined;
  if (!table) {
    return {
      ok: false,
      error: {
        code: 'unknown_table',
        message: `oracle table "${tableId ?? ''}" not found`,
        hint: 'use an id from the oracle catalog in the system prompt',
      },
    };
  }
  const rollable = table as OracleRollable;
  return {
    ok: true,
    payload: {
      id: rollable._id,
      name: rollable.name,
      rows: rollable.rows.map((row) => ({ min: row.min, max: row.max, text: row.text })),
    },
  };
}

function rollOracleTool(ctx: ExecutorContext, args: ParsedArgs): ToolExecution {
  const tableId = str(args, 'table_id');
  if (tableId === undefined) {
    return { ok: false, error: { code: 'invalid_input', message: 'table_id is required' } };
  }
  try {
    const result = rollOracle(tableId, ctx);
    return {
      ok: true,
      payload: {
        tableId: result.tableId,
        roll: result.roll,
        match: result.match,
        text: result.text,
        suggestion: result.suggestion,
        nested: result.nested,
      },
    };
  } catch (e: unknown) {
    const error = e as { code?: string; message?: string; hint?: string };
    if (typeof error.code === 'string' && typeof error.message === 'string') {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.hint !== undefined ? { hint: error.hint } : {}),
        },
      };
    }
    return {
      ok: false,
      error: { code: 'internal_error', message: e instanceof Error ? e.message : String(e) },
    };
  }
}

function eventTool(ctx: ExecutorContext, event: EngineEvent): ToolExecution {
  return reduceEvent(ctx, event).execution;
}

const FULFILL_VOW_MOVE = 'starforged/moves/quest/fulfill_your_vow';
const FORSAKE_VOW_MOVE = 'starforged/moves/quest/forsake_your_vow';
const FORGE_BOND_MOVE = 'starforged/moves/connection/forge_a_bond';

interface LifecycleRoll {
  execution: ToolExecution;
  outcomeKind?: string;
  engineOutcome?: unknown;
}

/** roll the challenge dice against a track, returning outcome info for lifecycle tools */
function rollProgressTrack(ctx: ExecutorContext, trackId: string): LifecycleRoll {
  const { execution, reduceResult } = reduceEvent(ctx, { type: 'progress_roll', trackId });
  if (!execution.ok || !reduceResult?.ok) return { execution };
  const outcome = reduceResult.outcome;
  if (outcome.kind !== 'progress_roll') return { execution };
  return {
    execution: { ok: true, payload: outcome },
    outcomeKind: outcome.outcome,
    engineOutcome: outcome,
  };
}

function lifecycleText(
  ctx: ExecutorContext,
  moveId: string,
  outcomeKind: string | undefined,
): { moveName: string; text: string } {
  const move = ctx.index.getMove(moveId);
  const node = move as unknown as MoveNodeShape | undefined;
  const moveName = node?.name ?? moveId;
  if (!node) return { moveName, text: '' };
  const raw = outcomeKind
    ? outcomeTexts(node.outcomes)[outcomeKind as keyof MoveOutcomeTexts]?.text
    : undefined;
  const expanded = raw ? expandMoveText(raw, ctx) : { text: node.text ?? '', nested: [] };
  return { moveName, text: expanded.text };
}

function fulfillVow(ctx: ExecutorContext, args: ParsedArgs): ToolExecution {
  const trackId = str(args, 'track_id');
  if (trackId === undefined) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'fulfill_vow requires track_id' },
    };
  }
  const track = ctx.getState().tracks[trackId];
  if (!track || track.kind !== 'vow') {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: `track "${trackId}" is not a vow track`,
        hint: 'pass the track id of a kind=vow track created by swear_vow',
      },
    };
  }
  const rolled = rollProgressTrack(ctx, trackId);
  if (!rolled.execution.ok) return rolled.execution;
  const outcomeKind = rolled.outcomeKind as 'strong_hit' | 'weak_hit' | 'miss';
  const { moveName, text } = lifecycleText(ctx, FULFILL_VOW_MOVE, outcomeKind);
  if (outcomeKind === 'miss') {
    return {
      ok: true,
      payload: {
        move: { id: FULFILL_VOW_MOVE, name: moveName },
        outcomeKind,
        engineOutcome: rolled.engineOutcome,
        text,
        note: 'The vow is undone: offer the player to forsake it (forsake_vow) or recommit (update_track: clear boxes and raise the rank).',
      },
    };
  }
  const reward = str(args, 'reward') ?? 'full';
  const levelsDown = outcomeKind === 'weak_hit' && reward === 'one_rank_lower' ? 1 : 0;
  const ticks = track.rank ? legacyRewardTicks(track.rank, levelsDown) : 0;
  const legacy = reduceEvent(ctx, { type: 'adjust_legacy', legacy: 'quests_legacy', ticks });
  if (!legacy.execution.ok) return legacy.execution;
  const removed = reduceEvent(ctx, { type: 'remove_track', trackId });
  if (!removed.execution.ok) return removed.execution;
  return {
    ok: true,
    payload: {
      move: { id: FULFILL_VOW_MOVE, name: moveName },
      outcomeKind,
      engineOutcome: rolled.engineOutcome,
      legacyReward: { legacy: 'quests_legacy', ticks },
      trackRemoved: trackId,
      text,
    },
  };
}

function forsakeVow(ctx: ExecutorContext, args: ParsedArgs): ToolExecution {
  const trackId = str(args, 'track_id');
  if (trackId === undefined) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'forsake_vow requires track_id' },
    };
  }
  const track = ctx.getState().tracks[trackId];
  if (!track || track.kind !== 'vow') {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: `track "${trackId}" is not a vow track`,
      },
    };
  }
  const removed = reduceEvent(ctx, { type: 'remove_track', trackId });
  if (!removed.execution.ok) return removed.execution;
  const { moveName, text } = lifecycleText(ctx, FORSAKE_VOW_MOVE, undefined);
  return {
    ok: true,
    payload: {
      move: { id: FORSAKE_VOW_MOVE, name: moveName },
      trackRemoved: trackId,
      text,
      note: 'The vow is cleared: apply the narrative cost with matching tools (e.g. adjust_momentum, discard_asset).',
    },
  };
}

function forgeBond(ctx: ExecutorContext, args: ParsedArgs): ToolExecution {
  const trackId = str(args, 'track_id');
  if (trackId === undefined) {
    return { ok: false, error: { code: 'invalid_input', message: 'forge_bond requires track_id' } };
  }
  const track = ctx.getState().tracks[trackId];
  if (!track || track.kind !== 'connection') {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: `track "${trackId}" is not a connection track`,
        hint: 'pass the track id of a kind=connection track',
      },
    };
  }
  const rolled = rollProgressTrack(ctx, trackId);
  if (!rolled.execution.ok) return rolled.execution;
  const outcomeKind = rolled.outcomeKind as 'strong_hit' | 'weak_hit' | 'miss';
  const { moveName, text } = lifecycleText(ctx, FORGE_BOND_MOVE, outcomeKind);
  if (outcomeKind === 'miss') {
    return {
      ok: true,
      payload: {
        move: { id: FORGE_BOND_MOVE, name: moveName },
        outcomeKind,
        engineOutcome: rolled.engineOutcome,
        text,
        note: 'At odds: offer the player to recommit (update_track: clear boxes and raise the rank) or let the connection go.',
      },
    };
  }
  if (outcomeKind === 'weak_hit' && args['confirmed'] !== true) {
    return {
      ok: true,
      payload: {
        move: { id: FORGE_BOND_MOVE, name: moveName },
        outcomeKind,
        engineOutcome: rolled.engineOutcome,
        text,
        note: 'The connection asks something first: roleplay the request and complete it (or swear an iron vow), then call forge_bond again with confirmed=true.',
      },
    };
  }
  const ticks = track.rank ? legacyRewardTicks(track.rank) : 0;
  const legacy = reduceEvent(ctx, { type: 'adjust_legacy', legacy: 'bonds_legacy', ticks });
  if (!legacy.execution.ok) return legacy.execution;
  const removed = reduceEvent(ctx, { type: 'remove_track', trackId });
  if (!removed.execution.ok) return removed.execution;
  return {
    ok: true,
    payload: {
      move: { id: FORGE_BOND_MOVE, name: moveName },
      outcomeKind,
      engineOutcome: rolled.engineOutcome,
      legacyReward: { legacy: 'bonds_legacy', ticks },
      trackRemoved: trackId,
      text,
    },
  };
}

function coerceRank(value: unknown): ChallengeRank | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return value as ChallengeRank;
  return undefined;
}

function bool(args: ParsedArgs, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
}

/** Execute one tool call against the engine. State changes only via `reduce`. */
export function executeToolCall(
  name: string,
  argumentsJson: string,
  ctx: ExecutorContext,
): ToolExecution {
  const args = parseArgs(argumentsJson);
  if ('code' in args && 'message' in args) {
    return { ok: false, error: args as ToolErrorShape };
  }
  switch (name) {
    case 'make_move':
      return makeMove(ctx, args);
    case 'roll_oracle':
      return rollOracleTool(ctx, args);
    case 'get_move_detail':
      return moveDetail(ctx, args);
    case 'get_oracle_detail':
      return oracleDetail(ctx, args);
    case 'adjust_meter': {
      const meter = str(args, 'meter') as ConditionMeterId | undefined;
      const delta = int(args, 'delta');
      if (meter === undefined || delta === undefined) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message:
              'adjust_meter requires meter (health/spirit/supply) and a non-zero integer delta',
          },
        };
      }
      return eventTool(ctx, { type: 'adjust_meter', meter, delta });
    }
    case 'adjust_momentum': {
      const delta = int(args, 'delta');
      if (delta === undefined) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message: 'adjust_momentum requires a non-zero integer delta',
          },
        };
      }
      return eventTool(ctx, { type: 'adjust_momentum', delta });
    }
    case 'burn_momentum': {
      const rollId = str(args, 'roll_id');
      if (rollId === undefined) {
        return {
          ok: false,
          error: { code: 'invalid_input', message: 'burn_momentum requires roll_id' },
        };
      }
      return eventTool(ctx, { type: 'burn_momentum', rollId });
    }
    case 'mark_impact': {
      const impactId = str(args, 'impact_id');
      if (impactId === undefined) {
        return {
          ok: false,
          error: { code: 'invalid_input', message: 'mark_impact requires impact_id' },
        };
      }
      const assetId = str(args, 'asset_id');
      return eventTool(ctx, { type: 'mark_impact', impactId, ...(assetId ? { assetId } : {}) });
    }
    case 'clear_impact': {
      const impactId = str(args, 'impact_id');
      if (impactId === undefined) {
        return {
          ok: false,
          error: { code: 'invalid_input', message: 'clear_impact requires impact_id' },
        };
      }
      return eventTool(ctx, { type: 'clear_impact', impactId });
    }
    case 'add_track': {
      const title = str(args, 'title');
      if (title === undefined) {
        return { ok: false, error: { code: 'invalid_input', message: 'add_track requires title' } };
      }
      const rank = coerceRank(args['rank']);
      if (rank === undefined) {
        return {
          ok: false,
          error: { code: 'invalid_input', message: 'add_track requires rank (string or null)' },
        };
      }
      const kind = str(args, 'kind') as TrackKind | undefined;
      return eventTool(ctx, { type: 'add_track', title, rank, ...(kind ? { kind } : {}) });
    }
    case 'swear_vow': {
      const title = str(args, 'title');
      const rank = coerceRank(args['rank']);
      if (title === undefined || rank === undefined) {
        return {
          ok: false,
          error: { code: 'invalid_input', message: 'swear_vow requires title and rank' },
        };
      }
      return eventTool(ctx, { type: 'add_track', title, rank, kind: 'vow' });
    }
    case 'mark_progress': {
      const trackId = str(args, 'track_id');
      if (trackId === undefined) {
        return {
          ok: false,
          error: { code: 'invalid_input', message: 'mark_progress requires track_id' },
        };
      }
      const marks = int(args, 'marks');
      return eventTool(ctx, {
        type: 'mark_progress',
        trackId,
        ...(marks !== undefined ? { marks } : {}),
      });
    }
    case 'set_flag': {
      const key = str(args, 'key');
      if (key === undefined || !('value' in args)) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message: 'set_flag requires key and value',
            hint: 'pass a JSON object like {"key": "flag_name", "value": <string, number, boolean, null, array or object>}',
          },
        };
      }
      return eventTool(ctx, { type: 'set_flag', key, value: args['value'] as JsonValue });
    }
    case 'add_journal_entry': {
      const text = str(args, 'text');
      if (text === undefined) {
        return {
          ok: false,
          error: { code: 'invalid_input', message: 'add_journal_entry requires text' },
        };
      }
      const { execution, reduceResult } = reduceEvent(ctx, { type: 'add_journal_entry', text });
      if (!execution.ok || !reduceResult?.ok) return execution;
      // the outcome carries only entryId; attach the note for UI display
      return { ok: true, payload: { ...reduceResult.outcome, text } };
    }
    case 'end_scene':
      return eventTool(ctx, { type: 'end_scene' });
    case 'add_asset': {
      const assetId = str(args, 'asset_id');
      if (assetId === undefined) {
        return {
          ok: false,
          error: { code: 'invalid_input', message: 'add_asset requires asset_id' },
        };
      }
      const pay = bool(args, 'pay_with_experience');
      const attachTo = str(args, 'attach_to');
      return eventTool(ctx, {
        type: 'add_asset',
        assetId,
        ...(pay !== undefined ? { payWithExperience: pay } : {}),
        ...(attachTo !== undefined ? { attachTo } : {}),
      });
    }
    case 'discard_asset': {
      const assetId = str(args, 'asset_id');
      if (assetId === undefined) {
        return {
          ok: false,
          error: { code: 'invalid_input', message: 'discard_asset requires asset_id' },
        };
      }
      return eventTool(ctx, { type: 'discard_asset', assetId });
    }
    case 'enable_ability': {
      const assetId = str(args, 'asset_id');
      const abilityIndex = int(args, 'ability_index');
      if (assetId === undefined || abilityIndex === undefined) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message: 'enable_ability requires asset_id and ability_index (0-2)',
          },
        };
      }
      const pay = bool(args, 'pay_with_experience');
      const confirmed = bool(args, 'requirement_confirmed');
      return eventTool(ctx, {
        type: 'enable_ability',
        assetId,
        abilityIndex,
        ...(pay !== undefined ? { payWithExperience: pay } : {}),
        ...(confirmed !== undefined ? { requirementConfirmed: confirmed } : {}),
      });
    }
    case 'adjust_asset_meter': {
      const assetId = str(args, 'asset_id');
      const control = str(args, 'control');
      const delta = int(args, 'delta');
      if (assetId === undefined || control === undefined || delta === undefined) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message: 'adjust_asset_meter requires asset_id, control and a non-zero integer delta',
          },
        };
      }
      return eventTool(ctx, { type: 'adjust_asset_meter', assetId, control, delta });
    }
    case 'set_asset_control': {
      const assetId = str(args, 'asset_id');
      const control = str(args, 'control');
      const value = bool(args, 'value');
      if (assetId === undefined || control === undefined || value === undefined) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message: 'set_asset_control requires asset_id, control and a boolean value',
          },
        };
      }
      return eventTool(ctx, { type: 'set_asset_control', assetId, control, value });
    }
    case 'adjust_legacy': {
      const legacy = str(args, 'legacy');
      const ticks = int(args, 'ticks');
      if (
        legacy === undefined ||
        ticks === undefined ||
        !(
          legacy === 'quests_legacy' ||
          legacy === 'bonds_legacy' ||
          legacy === 'discoveries_legacy'
        )
      ) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message:
              'adjust_legacy requires legacy (quests_legacy/bonds_legacy/discoveries_legacy) and a non-zero integer ticks',
          },
        };
      }
      return eventTool(ctx, { type: 'adjust_legacy', legacy, ticks });
    }
    case 'update_track': {
      const trackId = str(args, 'track_id');
      if (trackId === undefined) {
        return {
          ok: false,
          error: { code: 'invalid_input', message: 'update_track requires track_id' },
        };
      }
      const title = str(args, 'title');
      const rank = str(args, 'rank') as ChallengeRank | undefined;
      const ticks = int(args, 'ticks');
      if (title === undefined && rank === undefined && ticks === undefined) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message: 'update_track requires at least one of title/rank/ticks',
          },
        };
      }
      return eventTool(ctx, {
        type: 'update_track',
        trackId,
        ...(title !== undefined ? { title } : {}),
        ...(rank !== undefined ? { rank } : {}),
        ...(ticks !== undefined ? { ticks } : {}),
      });
    }
    case 'fulfill_vow':
      return fulfillVow(ctx, args);
    case 'forsake_vow':
      return forsakeVow(ctx, args);
    case 'forge_bond':
      return forgeBond(ctx, args);
    case 'mark_bond_decrease': {
      const ticks = int(args, 'ticks');
      if (ticks === undefined || ticks < 1) {
        return {
          ok: false,
          error: {
            code: 'invalid_input',
            message: 'mark_bond_decrease requires a positive integer ticks',
          },
        };
      }
      return eventTool(ctx, { type: 'adjust_legacy', legacy: 'bonds_legacy', ticks: -ticks });
    }
    default:
      return {
        ok: false,
        error: {
          code: 'unknown_tool',
          message: `tool "${name}" is not registered`,
          hint: 'use only the tools listed in this conversation',
        },
      };
  }
}

export function toolResultContent(execution: ToolExecution): string {
  return JSON.stringify(execution.ok ? execution.payload : { error: execution.error });
}

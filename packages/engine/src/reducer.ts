import type { ConditionMeterId, StarforgedIndex } from '@starwright/data';
import type { EngineEvent } from './events.js';
import type {
  ActionRollOutcome,
  AssetSnapshot,
  AuditEntry,
  EngineError,
  EngineOutcome,
  ReduceResult,
} from './audit.js';
import type { CampaignState, ChallengeRank, JournalEntry, TrackKind } from './state/types.js';
import { JOURNAL_LIMIT, STATE_VERSION } from './state/types.js';
import {
  EngineFailure,
  findImpactDef,
  getActiveCharacter,
  isLegacyTrackId,
  isPermanentImpact,
  markedImpact,
  momentumMax,
  momentumReset,
} from './state/create.js';
import {
  computeActionRoll,
  computeProgressRoll,
  rollChallengePair,
  rollDie,
  type ActionDice,
} from './dice/rolls.js';
import { MARK_TICKS_BY_RANK, clampTicks, progressScore } from './tracks/tracks.js';
import {
  assetControlInfos,
  assetDisabled,
  getAssetInstance,
  globMatch,
  impactControlsUnderMeter,
  initialAssetInstance,
  legacyRequirement,
  meterControlInfo,
} from './assets/assets.js';

export interface EngineContext {
  index: StarforgedIndex;
  rng: () => number;
}

const METER_IDS: readonly string[] = ['health', 'spirit', 'supply'];
const TRACK_KINDS: readonly TrackKind[] = ['vow', 'fray', 'expedition', 'connection', 'other'];
const CHALLENGE_RANKS: readonly string[] = [
  'troublesome',
  'dangerous',
  'formidable',
  'extreme',
  'epic',
];

interface Handled {
  outcome: EngineOutcome;
  /** when provided, this entry is appended instead of a generic settlement entry */
  entry?: JournalEntry;
}

function toError(e: unknown): EngineError {
  if (e instanceof EngineFailure) {
    return e.hint === undefined
      ? { code: e.code, message: e.message }
      : { code: e.code, message: e.message, hint: e.hint };
  }
  return { code: 'internal_error', message: e instanceof Error ? e.message : String(e) };
}

function fail(state: CampaignState, event: EngineEvent, error: EngineError): ReduceResult {
  const log: AuditEntry = { id: `audit-${state.seq}`, event, ok: false, error };
  return { ok: false, state, error, log };
}

function trimJournal(journal: JournalEntry[]): void {
  if (journal.length > JOURNAL_LIMIT) {
    journal.splice(0, journal.length - JOURNAL_LIMIT);
  }
}

export function reduce(state: CampaignState, event: EngineEvent, ctx: EngineContext): ReduceResult {
  if (state.version !== STATE_VERSION) {
    return fail(state, event, {
      code: 'version_mismatch',
      message: `state version ${state.version} is not supported (expected ${STATE_VERSION})`,
    });
  }
  const next = structuredClone(state) as CampaignState;
  let handled: Handled;
  try {
    handled = handle(next, event, ctx);
  } catch (e) {
    return fail(state, event, toError(e));
  }
  const entry =
    handled.entry ??
    ({
      id: `jr-${next.seq++}`,
      kind: 'settlement',
      sceneIndex: next.scene.index,
      outcome: handled.outcome,
    } satisfies JournalEntry);
  next.journal.push(entry);
  trimJournal(next.journal);
  const log: AuditEntry = { id: `audit-${next.seq++}`, event, ok: true };
  return { ok: true, state: next, outcome: handled.outcome, log };
}

function requireOneRollSelection(event: {
  stat?: string;
  meter?: string;
  assetMeter?: { assetId: string; control: string };
}): void {
  const given = [event.stat, event.meter, event.assetMeter].filter((v) => v !== undefined);
  if (given.length > 1) {
    throw new EngineFailure(
      'both_roll_selections',
      'action_roll accepts at most one of "stat", "meter" or "assetMeter"',
      'pick the stat, condition meter or asset meter named by the move trigger, e.g. {"stat":"wits"}',
    );
  }
}

function resolveAssetMeter(
  state: CampaignState,
  ctx: EngineContext,
  assetMeter: { assetId: string; control: string },
): number {
  const instance = getAssetInstance(state, assetMeter.assetId);
  const def = ctx.index.getAsset(instance.assetId);
  if (!def) {
    throw new EngineFailure('unknown_asset', `asset "${instance.assetId}" not found`);
  }
  if (assetDisabled(instance, ctx.index)) {
    throw new EngineFailure(
      'asset_disabled',
      `asset "${def.name}" (${instance.id}) is out of action`,
      'restore the asset (heal/repair) before rolling with its meters',
    );
  }
  meterControlInfo(def, assetMeter.control);
  const value = instance.meters[assetMeter.control];
  if (typeof value !== 'number') {
    throw new EngineFailure(
      'asset_control_missing',
      `asset instance "${instance.id}" has no meter value for "${assetMeter.control}"`,
    );
  }
  return value;
}

function handleActionRoll(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'action_roll' }>,
  ctx: EngineContext,
): Handled {
  requireOneRollSelection(event);
  // M4: stat/meter may both be absent (e.g. Develop Your Relationship rolls +rank,
  // the rank value arrives as `add`); the base is then 0.
  const character = getActiveCharacter(state);
  let baseValue = 0;
  if (event.stat !== undefined) {
    baseValue = character.stats[event.stat];
  } else if (event.meter !== undefined) {
    baseValue = character.meters[event.meter as ConditionMeterId];
  } else if (event.assetMeter !== undefined) {
    // M5: asset_control triggers roll with the asset's condition meter
    baseValue = resolveAssetMeter(state, ctx, event.assetMeter);
  }
  if (typeof baseValue !== 'number') {
    throw new EngineFailure('invalid_input', 'roll selection value is not a number');
  }
  const add = event.add ?? 0;
  if (!Number.isInteger(add) || Math.abs(add) > 10) {
    throw new EngineFailure(
      'invalid_add',
      `add must be an integer in [-10, 10], got ${String(event.add)}`,
    );
  }
  const dice: ActionDice = {
    actionDie: rollDie(ctx.rng, 10),
    challenge: rollChallengePair(ctx.rng),
  };
  const rollId = `roll-${state.seq++}`;
  const result = computeActionRoll(
    { stat: event.stat, meter: event.meter, assetMeter: event.assetMeter, add },
    dice,
    {
      baseValue,
      momentum: state.momentum,
    },
  );
  const outcome: ActionRollOutcome = { kind: 'action_roll', rollId, ...result };
  return { outcome };
}

function handleProgressRoll(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'progress_roll' }>,
  ctx: EngineContext,
): Handled {
  let ticks: number;
  let score: number;
  if (isLegacyTrackId(event.trackId)) {
    const track = state.legacy[event.trackId];
    ticks = track.ticks;
    score = progressScore(track.ticks, track.cleared);
  } else {
    const track = state.tracks[event.trackId];
    if (!track) {
      throw new EngineFailure(
        'unknown_track',
        `track "${event.trackId}" not found`,
        'use add_track first, or roll against a legacy track (quests_legacy/bonds_legacy/discoveries_legacy)',
      );
    }
    ticks = track.ticks;
    score = progressScore(track.ticks);
  }
  const challenge = rollChallengePair(ctx.rng);
  const rollId = `roll-${state.seq++}`;
  const result = computeProgressRoll(score, challenge);
  return {
    outcome: { kind: 'progress_roll', rollId, trackId: event.trackId, ticks, ...result },
  };
}

function findRollOutcome(state: CampaignState, rollId: string): ActionRollOutcome | undefined {
  for (let i = state.journal.length - 1; i >= 0; i--) {
    const outcome = state.journal[i]?.outcome;
    if (!outcome) continue;
    if (outcome.kind === 'burn_momentum' && outcome.rollId === rollId) {
      throw new EngineFailure('already_burned', `roll "${rollId}" has already been burned`);
    }
    if (outcome.kind === 'action_roll' && outcome.rollId === rollId) return outcome;
  }
  return undefined;
}

function handleBurnMomentum(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'burn_momentum' }>,
  ctx: EngineContext,
): Handled {
  const target = findRollOutcome(state, event.rollId);
  if (!target) {
    throw new EngineFailure(
      'unknown_roll',
      `action roll "${event.rollId}" not found in journal`,
      'burn_momentum must reference the rollId of a previous action_roll in this campaign',
    );
  }
  if (state.momentum <= 0) {
    throw new EngineFailure(
      'burn_requires_positive_momentum',
      `momentum is ${state.momentum}; only positive momentum can be burned`,
    );
  }
  const momentumBefore = state.momentum;
  const result = computeActionRoll(
    {
      stat: target.stat,
      meter: target.meter,
      assetMeter: target.assetMeter,
      add: target.add,
      momentumBurn: true,
    },
    target.dice,
    { baseValue: target.baseValue, momentum: momentumBefore },
  );
  const reset = momentumReset(state, ctx.index);
  state.momentum = reset;
  return {
    outcome: {
      kind: 'burn_momentum',
      rollId: event.rollId,
      result,
      momentumBefore,
      momentumAfter: state.momentum,
      reset,
    },
  };
}

function handleAdjustMomentum(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'adjust_momentum' }>,
  ctx: EngineContext,
): Handled {
  if (!Number.isInteger(event.delta) || event.delta === 0) {
    throw new EngineFailure(
      'invalid_delta',
      `delta must be a non-zero integer, got ${String(event.delta)}`,
    );
  }
  const before = state.momentum;
  const max = momentumMax(state, ctx.index);
  state.momentum = Math.max(-6, Math.min(max, before + event.delta));
  return {
    outcome: {
      kind: 'adjust_momentum',
      delta: event.delta,
      before,
      after: state.momentum,
      momentumMax: max,
    },
  };
}

function findMeterBlocker(
  state: CampaignState,
  ctx: EngineContext,
  meter: ConditionMeterId,
): string | undefined {
  for (const impact of getActiveCharacter(state).impacts) {
    const def = ctx.index.data.rules.impacts[impact.category]?.contents[impact.impactId];
    if (def?.prevents_recovery?.includes(meter)) return impact.impactId;
  }
  return undefined;
}

function handleAdjustMeter(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'adjust_meter' }>,
  ctx: EngineContext,
): Handled {
  if (!(METER_IDS as readonly string[]).includes(event.meter)) {
    throw new EngineFailure('invalid_meter', `unknown condition meter "${String(event.meter)}"`);
  }
  if (!Number.isInteger(event.delta) || event.delta === 0) {
    throw new EngineFailure(
      'invalid_delta',
      `delta must be a non-zero integer, got ${String(event.delta)}`,
    );
  }
  const character = getActiveCharacter(state);
  const before = character.meters[event.meter];
  if (event.delta > 0) {
    const blocker = findMeterBlocker(state, ctx, event.meter);
    if (blocker !== undefined) {
      throw new EngineFailure(
        'meter_recovery_blocked',
        `cannot increase ${event.meter}: impact "${blocker}" prevents recovery`,
        'clear the impact with clear_impact via a recover move first',
      );
    }
  }
  character.meters[event.meter] = Math.max(0, Math.min(5, before + event.delta));
  return {
    outcome: {
      kind: 'adjust_meter',
      meter: event.meter,
      delta: event.delta,
      before,
      after: character.meters[event.meter],
    },
  };
}

function handleMarkImpact(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'mark_impact' }>,
  ctx: EngineContext,
): Handled {
  const def = findImpactDef(ctx.index, event.impactId);
  if (!def) {
    throw new EngineFailure(
      'unknown_impact',
      `impact "${event.impactId}" not found in rules.impacts`,
      'valid ids include wounded, shaken, unprepared, battered, cursed, doomed, tormented, indebted, permanently_harmed, traumatized',
    );
  }
  if (markedImpact(state, event.impactId)) {
    throw new EngineFailure(
      'impact_already_marked',
      `impact "${event.impactId}" is already marked`,
    );
  }
  if (def.category === 'vehicle_troubles' && event.assetId === undefined) {
    throw new EngineFailure(
      'vehicle_impact_requires_asset',
      `vehicle impact "${event.impactId}" requires the assetId of the affected vehicle`,
    );
  }
  const character = getActiveCharacter(state);
  character.impacts.push({
    impactId: def.impactId,
    category: def.category,
    assetId: event.assetId,
    permanent: isPermanentImpact(def),
  });
  return {
    outcome: {
      kind: 'mark_impact',
      impactId: def.impactId,
      impacts: character.impacts.map((i) => i.impactId),
    },
  };
}

function handleClearImpact(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'clear_impact' }>,
  ctx: EngineContext,
): Handled {
  const marked = markedImpact(state, event.impactId);
  if (!marked) {
    throw new EngineFailure('impact_not_marked', `impact "${event.impactId}" is not marked`);
  }
  const def = findImpactDef(ctx.index, event.impactId);
  if ((def && isPermanentImpact(def)) || marked.permanent) {
    throw new EngineFailure(
      'impact_permanent',
      `impact "${event.impactId}" is permanent and cannot be cleared`,
    );
  }
  const character = getActiveCharacter(state);
  character.impacts = character.impacts.filter((i) => i.impactId !== event.impactId);
  return {
    outcome: {
      kind: 'clear_impact',
      impactId: event.impactId,
      impacts: character.impacts.map((i) => i.impactId),
    },
  };
}

function handleAddTrack(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'add_track' }>,
): Handled {
  if (typeof event.title !== 'string' || event.title.trim().length === 0) {
    throw new EngineFailure('invalid_title', 'title must be a non-empty string');
  }
  if (event.rank !== null && !(CHALLENGE_RANKS as readonly string[]).includes(event.rank)) {
    throw new EngineFailure(
      'invalid_rank',
      `rank must be null or one of ${CHALLENGE_RANKS.join('/')}, got ${String(event.rank)}`,
    );
  }
  const kind: TrackKind = event.kind ?? 'other';
  if (!(TRACK_KINDS as readonly string[]).includes(kind)) {
    throw new EngineFailure('invalid_kind', `kind must be one of ${TRACK_KINDS.join('/')}`);
  }
  const trackId = `track-${state.seq++}`;
  state.tracks[trackId] = { title: event.title.trim(), rank: event.rank, kind, ticks: 0 };
  return {
    outcome: {
      kind: 'add_track',
      trackId,
      title: event.title.trim(),
      rank: event.rank,
      trackKind: kind,
    },
  };
}

function handleMarkProgress(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'mark_progress' }>,
): Handled {
  const track = state.tracks[event.trackId];
  if (!track) {
    throw new EngineFailure(
      'unknown_track',
      `track "${event.trackId}" not found`,
      'legacy tracks are adjusted via adjust_legacy, not mark_progress',
    );
  }
  if (event.marks !== undefined && event.ticks !== undefined) {
    throw new EngineFailure('ambiguous_mark', 'pass either "marks" or "ticks", not both');
  }
  let added: number;
  if (event.ticks !== undefined) {
    if (!Number.isInteger(event.ticks) || event.ticks < 1 || event.ticks > 40) {
      throw new EngineFailure(
        'invalid_ticks',
        `ticks must be an integer in [1, 40], got ${String(event.ticks)}`,
      );
    }
    added = event.ticks;
  } else {
    const marks = event.marks ?? 1;
    if (!Number.isInteger(marks) || marks < 1 || marks > 10) {
      throw new EngineFailure(
        'invalid_marks',
        `marks must be an integer in [1, 10], got ${String(event.marks)}`,
      );
    }
    if (track.rank === null) {
      throw new EngineFailure(
        'rank_required',
        `track "${event.trackId}" has no rank; pass explicit "ticks" instead`,
      );
    }
    added = MARK_TICKS_BY_RANK[track.rank] * marks;
  }
  const before = track.ticks;
  track.ticks = clampTicks(before + added);
  return {
    outcome: {
      kind: 'mark_progress',
      trackId: event.trackId,
      ticksAdded: track.ticks - before,
      ticks: track.ticks,
    },
  };
}

function handleAdjustLegacy(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'adjust_legacy' }>,
): Handled {
  if (!isLegacyTrackId(event.legacy)) {
    throw new EngineFailure(
      'unknown_legacy',
      `legacy "${event.legacy}" not found`,
      'valid ids: quests_legacy, bonds_legacy, discoveries_legacy',
    );
  }
  if (!Number.isInteger(event.ticks) || event.ticks === 0 || Math.abs(event.ticks) > 40) {
    throw new EngineFailure(
      'invalid_ticks',
      `ticks must be a non-zero integer in [-40, 40], got ${String(event.ticks)}`,
    );
  }
  const track = state.legacy[event.legacy];
  const before = track.ticks;
  let after = before;
  let experienceGained = 0;
  if (event.ticks > 0) {
    // M5: Earn Experience automation — each newly filled box grants 2 XP
    // (1 XP on a cleared track, Rules-Summary p4).
    after = Math.min(40, before + event.ticks);
    const rate = track.cleared ? 1 : 2;
    experienceGained = (Math.floor(after / 4) - Math.floor(before / 4)) * rate;
    state.experience += experienceGained;
    if (after >= 40) {
      // the tenth box fills: clear the track and resume on the empty track
      after = 0;
      track.cleared = true;
    }
  } else {
    // M5: bond decrease (negative ticks) — floor at 0, never touches XP
    after = Math.max(0, before + event.ticks);
  }
  const ticksAdded = event.ticks > 0 ? Math.min(before + event.ticks, 40) - before : after - before;
  track.ticks = after;
  return {
    outcome: {
      kind: 'adjust_legacy',
      legacy: event.legacy,
      ticksAdded,
      ticks: after,
      cleared: track.cleared,
      experienceGained,
      experience: state.experience,
    },
  };
}

function handleSetFlag(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'set_flag' }>,
): Handled {
  if (typeof event.key !== 'string' || event.key.length === 0) {
    throw new EngineFailure('invalid_flag', 'key must be a non-empty string');
  }
  state.scene.flags[event.key] = event.value;
  return { outcome: { kind: 'set_flag', key: event.key, value: event.value } };
}

function handleAddJournalEntry(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'add_journal_entry' }>,
): Handled {
  if (typeof event.text !== 'string' || event.text.trim().length === 0) {
    throw new EngineFailure('empty_text', 'text must be a non-empty string');
  }
  const entryId = `jr-${state.seq++}`;
  const entry: JournalEntry = {
    id: entryId,
    kind: 'note',
    sceneIndex: state.scene.index,
    note: event.text,
  };
  return { outcome: { kind: 'add_journal_entry', entryId }, entry };
}

function handleSetAboardVehicle(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'set_aboard_vehicle' }>,
): Handled {
  if (!Array.isArray(event.assetIds) || event.assetIds.some((id) => typeof id !== 'string')) {
    throw new EngineFailure('invalid_input', 'assetIds must be an array of asset ids');
  }
  state.scene.aboardVehicleAssetIds = [...new Set(event.assetIds)];
  return { outcome: { kind: 'set_aboard_vehicle', assetIds: state.scene.aboardVehicleAssetIds } };
}

function handleEndScene(state: CampaignState): Handled {
  state.scene.index += 1;
  return { outcome: { kind: 'end_scene', sceneIndex: state.scene.index } };
}

function assetSnapshot(
  state: CampaignState,
  index: StarforgedIndex,
  instanceId: string,
): AssetSnapshot {
  const instance = getAssetInstance(state, instanceId);
  const def = index.getAsset(instance.assetId);
  return {
    instanceId: instance.id,
    assetId: instance.assetId,
    name: def?.name ?? instance.assetId,
    enabledAbilities: [...instance.enabledAbilities],
    meters: { ...instance.meters },
    controls: { ...instance.controls },
    ...(instance.attachedTo !== undefined ? { attachedTo: instance.attachedTo } : {}),
  };
}

export const ADD_ASSET_COST = 3;
export const ENABLE_ABILITY_COST = 2;

function spendExperience(state: CampaignState, cost: number, purpose: string): void {
  if (state.experience < cost) {
    throw new EngineFailure(
      'insufficient_experience',
      `${purpose} costs ${cost} experience but only ${state.experience} is available`,
      'earn experience by filling legacy track boxes first',
    );
  }
  state.experience -= cost;
}

function handleAddAsset(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'add_asset' }>,
  ctx: EngineContext,
): Handled {
  const def = ctx.index.getAsset(event.assetId);
  if (!def) {
    throw new EngineFailure(
      'unknown_asset',
      `asset "${event.assetId}" not found in the catalog`,
      'use an id from the asset catalog (e.g. starforged/assets/command_vehicle/starship)',
    );
  }
  if (event.payWithExperience === true) {
    spendExperience(state, ADD_ASSET_COST, `buying asset "${def.name}"`);
  }
  const instance = initialAssetInstance(event.assetId, `asset-${state.seq++}`, ctx.index);
  if (event.attachTo !== undefined) {
    const host = getAssetInstance(state, event.attachTo);
    const hostDef = ctx.index.getAsset(host.assetId);
    const patterns = hostDef?.attachments?.assets ?? [];
    if (!patterns.some((pattern) => globMatch(pattern, instance.assetId))) {
      throw new EngineFailure(
        'invalid_attachment',
        `asset "${def.name}" cannot be attached to "${hostDef?.name ?? host.assetId}"`,
        `attachment patterns of the host: ${patterns.join(', ') || 'none'}`,
      );
    }
    instance.attachedTo = host.id;
  }
  state.assets.push(instance);
  return {
    outcome: {
      kind: 'add_asset',
      asset: assetSnapshot(state, ctx.index, instance.id),
      experienceCost: event.payWithExperience === true ? ADD_ASSET_COST : 0,
      experience: state.experience,
    },
  };
}

function handleDiscardAsset(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'discard_asset' }>,
  ctx: EngineContext,
): Handled {
  const instance = getAssetInstance(state, event.assetId);
  const snapshot = assetSnapshot(state, ctx.index, instance.id);
  state.assets = state.assets.filter((a) => a.id !== instance.id);
  // impacts tied to the discarded asset (e.g. battered) go with it
  const character = getActiveCharacter(state);
  const clearedImpacts = character.impacts
    .filter((impact) => impact.assetId === instance.id)
    .map((impact) => impact.impactId);
  character.impacts = character.impacts.filter((impact) => impact.assetId !== instance.id);
  return {
    outcome: {
      kind: 'discard_asset',
      asset: snapshot,
      clearedImpacts,
    },
  };
}

function handleEnableAbility(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'enable_ability' }>,
  ctx: EngineContext,
): Handled {
  const instance = getAssetInstance(state, event.assetId);
  const def = ctx.index.getAsset(instance.assetId);
  if (!def) {
    throw new EngineFailure('unknown_asset', `asset "${instance.assetId}" not found`);
  }
  const ability = def.abilities[event.abilityIndex];
  if (!ability) {
    throw new EngineFailure(
      'ability_not_found',
      `asset "${def.name}" has no ability ${event.abilityIndex}`,
      `abilities: 0-${def.abilities.length - 1}`,
    );
  }
  if (instance.enabledAbilities.includes(event.abilityIndex)) {
    throw new EngineFailure(
      'ability_already_enabled',
      `ability ${event.abilityIndex} of "${def.name}" is already enabled`,
    );
  }
  const requirement = legacyRequirement(def);
  if (requirement) {
    const boxes = Math.floor(state.legacy[requirement.legacy].ticks / 4);
    if (boxes < requirement.boxes) {
      throw new EngineFailure(
        'requirement_unmet',
        `asset "${def.name}" requires ${requirement.boxes} boxes on ${requirement.legacy} (currently ${boxes})`,
      );
    }
  } else if (def.requirement && event.requirementConfirmed !== true) {
    throw new EngineFailure(
      'requirement_confirmation_required',
      `asset "${def.name}" has a narrative requirement: ${def.requirement.slice(0, 160)}`,
      'confirm the requirement holds in the fiction by passing requirement_confirmed: true',
    );
  }
  if (event.payWithExperience === true) {
    spendExperience(state, ENABLE_ABILITY_COST, `upgrading asset "${def.name}"`);
  }
  instance.enabledAbilities.push(event.abilityIndex);
  instance.enabledAbilities.sort((a, b) => a - b);
  return {
    outcome: {
      kind: 'enable_ability',
      asset: assetSnapshot(state, ctx.index, instance.id),
      abilityIndex: event.abilityIndex,
      experienceCost: event.payWithExperience === true ? ENABLE_ABILITY_COST : 0,
      experience: state.experience,
    },
  };
}

function handleAdjustAssetMeter(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'adjust_asset_meter' }>,
  ctx: EngineContext,
): Handled {
  if (!Number.isInteger(event.delta) || event.delta === 0) {
    throw new EngineFailure(
      'invalid_delta',
      `delta must be a non-zero integer, got ${String(event.delta)}`,
    );
  }
  const instance = getAssetInstance(state, event.assetId);
  const def = ctx.index.getAsset(instance.assetId);
  if (!def) {
    throw new EngineFailure('unknown_asset', `asset "${instance.assetId}" not found`);
  }
  const info = meterControlInfo(def, event.control);
  const before = instance.meters[event.control] ?? info.min ?? 0;
  if (event.delta > 0) {
    // battered blocks integrity recovery until repaired (Rules-Summary p5)
    const impactKeys = impactControlsUnderMeter(def, event.control);
    const blocked = impactKeys.some((key) =>
      getActiveCharacter(state).impacts.some(
        (impact) => impact.assetId === instance.id && impact.impactId === key,
      ),
    );
    if (blocked) {
      throw new EngineFailure(
        'integrity_recovery_blocked',
        `cannot raise ${event.control}: an impact (${impactKeys.join(', ')}) is marked on "${def.name}"`,
        'repair first: clear the impact via a recover move, then raise the meter',
      );
    }
  }
  const after = Math.max(info.min ?? 0, Math.min(info.max ?? 5, before + event.delta));
  instance.meters[event.control] = after;
  return {
    outcome: {
      kind: 'adjust_asset_meter',
      asset: assetSnapshot(state, ctx.index, instance.id),
      control: event.control,
      delta: event.delta,
      before,
      after,
    },
  };
}

function handleSetAssetControl(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'set_asset_control' }>,
  ctx: EngineContext,
): Handled {
  const instance = getAssetInstance(state, event.assetId);
  const def = ctx.index.getAsset(instance.assetId);
  if (!def) {
    throw new EngineFailure('unknown_asset', `asset "${instance.assetId}" not found`);
  }
  const info = assetControlInfos(def).get(event.control);
  if (!info) {
    throw new EngineFailure(
      'asset_control_missing',
      `asset "${def.name}" has no control "${event.control}"`,
    );
  }
  if (info.fieldType === 'condition_meter') {
    throw new EngineFailure(
      'invalid_control_value',
      `control "${event.control}" is a condition meter; use adjust_asset_meter`,
    );
  }
  if (info.isImpact) {
    throw new EngineFailure(
      'control_is_impact',
      `control "${event.control}" is an impact; use mark_impact/clear_impact with asset_id`,
    );
  }
  if (typeof event.value !== 'boolean') {
    throw new EngineFailure('invalid_control_value', 'value must be a boolean');
  }
  instance.controls[event.control] = event.value;
  return {
    outcome: {
      kind: 'set_asset_control',
      asset: assetSnapshot(state, ctx.index, instance.id),
      control: event.control,
      value: event.value,
    },
  };
}

function handleRemoveTrack(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'remove_track' }>,
): Handled {
  const track = state.tracks[event.trackId];
  if (!track) {
    throw new EngineFailure('unknown_track', `track "${event.trackId}" not found`);
  }
  delete state.tracks[event.trackId];
  return {
    outcome: { kind: 'remove_track', trackId: event.trackId, title: track.title },
  };
}

function handleUpdateTrack(
  state: CampaignState,
  event: Extract<EngineEvent, { type: 'update_track' }>,
): Handled {
  const track = state.tracks[event.trackId];
  if (!track) {
    throw new EngineFailure('unknown_track', `track "${event.trackId}" not found`);
  }
  if (event.title === undefined && event.rank === undefined && event.ticks === undefined) {
    throw new EngineFailure(
      'invalid_input',
      'update_track requires at least one of title/rank/ticks',
    );
  }
  const outcome: {
    kind: 'update_track';
    trackId: string;
    title: string;
    rank: ChallengeRank | null;
    ticks: number;
    ticksBefore?: number;
    rankBefore?: ChallengeRank | null;
  } = {
    kind: 'update_track',
    trackId: event.trackId,
    title: track.title,
    rank: track.rank,
    ticks: track.ticks,
  };
  if (event.title !== undefined) {
    if (typeof event.title !== 'string' || event.title.trim().length === 0) {
      throw new EngineFailure('invalid_title', 'title must be a non-empty string');
    }
    outcome.title = event.title.trim();
    track.title = outcome.title;
  }
  if (event.rank !== undefined) {
    if (!(CHALLENGE_RANKS as readonly string[]).includes(event.rank)) {
      throw new EngineFailure(
        'invalid_rank',
        `rank must be one of ${CHALLENGE_RANKS.join('/')}, got ${String(event.rank)}`,
      );
    }
    outcome.rankBefore = track.rank;
    track.rank = event.rank;
    outcome.rank = event.rank;
  }
  if (event.ticks !== undefined) {
    if (!Number.isInteger(event.ticks) || event.ticks < 0 || event.ticks > 40) {
      throw new EngineFailure(
        'invalid_ticks',
        `ticks must be an integer in [0, 40], got ${String(event.ticks)}`,
      );
    }
    outcome.ticksBefore = track.ticks;
    track.ticks = event.ticks;
    outcome.ticks = event.ticks;
  }
  return { outcome };
}

function handle(state: CampaignState, event: EngineEvent, ctx: EngineContext): Handled {
  switch (event.type) {
    case 'action_roll':
      return handleActionRoll(state, event, ctx);
    case 'progress_roll':
      return handleProgressRoll(state, event, ctx);
    case 'burn_momentum':
      return handleBurnMomentum(state, event, ctx);
    case 'adjust_momentum':
      return handleAdjustMomentum(state, event, ctx);
    case 'adjust_meter':
      return handleAdjustMeter(state, event, ctx);
    case 'mark_impact':
      return handleMarkImpact(state, event, ctx);
    case 'clear_impact':
      return handleClearImpact(state, event, ctx);
    case 'add_track':
      return handleAddTrack(state, event);
    case 'mark_progress':
      return handleMarkProgress(state, event);
    case 'adjust_legacy':
      return handleAdjustLegacy(state, event);
    case 'set_flag':
      return handleSetFlag(state, event);
    case 'add_journal_entry':
      return handleAddJournalEntry(state, event);
    case 'set_aboard_vehicle':
      return handleSetAboardVehicle(state, event);
    case 'end_scene':
      return handleEndScene(state);
    case 'add_asset':
      return handleAddAsset(state, event, ctx);
    case 'discard_asset':
      return handleDiscardAsset(state, event, ctx);
    case 'enable_ability':
      return handleEnableAbility(state, event, ctx);
    case 'adjust_asset_meter':
      return handleAdjustAssetMeter(state, event, ctx);
    case 'set_asset_control':
      return handleSetAssetControl(state, event, ctx);
    case 'remove_track':
      return handleRemoveTrack(state, event);
    case 'update_track':
      return handleUpdateTrack(state, event);
  }
}

import type { ConditionMeterId, LegacyTrackId, StatId, StarforgedIndex } from '@starwright/data';
import type {
  CampaignState,
  ChallengeRank,
  CharacterState,
  MarkedImpact,
  ProgressTrack,
  AssetInstance,
} from './types.js';
import { CHALLENGE_RANKS, MOMENTUM_START, STATE_VERSION } from './types.js';
import { initialAssetInstance } from '../assets/assets.js';

export interface NewCampaignInput {
  characterName: string;
  stats: Record<StatId, number>;
  /** truth key → chosen option index (as decimal string, Datasworn keys '0'…) */
  truths?: Record<string, string>;
  /** M4: initial asset ids (engine validates shape; the host checks them against the index).
   *  Rules-Summary p6: three picked assets + the STARSHIP command vehicle. */
  assets?: string[];
  /** M5: index used to initialize asset meters/controls from the definitions */
  index?: StarforgedIndex;
  /** M4: optional background vow, materialized as a kind='vow' track (track-<seq>) */
  backgroundVow?: { title: string; rank: ChallengeRank | null };
  /** M6: optional player-written character background; validated as a string, trimmed */
  background?: string;
  /**
   * Player-set content flags (Set a Flag): trimmed, empties dropped,
   * deduplicated. Player authority only — never modified by engine events.
   */
  contentFlags?: string[];
}

export class EngineFailure extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = 'EngineFailure';
    this.code = code;
    this.hint = hint;
  }
}

const STAT_IDS: readonly StatId[] = ['edge', 'heart', 'iron', 'shadow', 'wits'];
const METER_IDS: readonly ConditionMeterId[] = ['health', 'spirit', 'supply'];
const LEGACY_IDS: readonly LegacyTrackId[] = [
  'quests_legacy',
  'bonds_legacy',
  'discoveries_legacy',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createNewCampaign(input: NewCampaignInput): CampaignState {
  if (typeof input.characterName !== 'string' || input.characterName.trim().length === 0) {
    throw new EngineFailure('invalid_input', 'characterName must be a non-empty string');
  }
  if (!isRecord(input.stats)) {
    throw new EngineFailure('invalid_input', 'stats must be an object keyed by stat id');
  }
  const stats: Record<StatId, number> = { edge: 0, heart: 0, iron: 0, shadow: 0, wits: 0 };
  for (const stat of STAT_IDS) {
    const value = input.stats[stat];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5) {
      throw new EngineFailure(
        'invalid_input',
        `stat "${stat}" must be an integer in [0, 5]; character creation assigns 1-3`,
      );
    }
    stats[stat] = value;
  }
  if (input.background !== undefined && typeof input.background !== 'string') {
    throw new EngineFailure('invalid_input', 'background must be a string');
  }
  const character: CharacterState = {
    id: 'char-1',
    name: input.characterName.trim(),
    background: (input.background ?? '').trim(),
    stats,
    meters: { health: 5, spirit: 5, supply: 5 },
    impacts: [],
  };
  const assets: AssetInstance[] = [];
  if (input.assets !== undefined) {
    if (!Array.isArray(input.assets)) {
      throw new EngineFailure('invalid_input', 'assets must be an array of asset ids');
    }
    input.assets.forEach((assetId, index_) => {
      if (typeof assetId !== 'string' || assetId.trim().length === 0) {
        throw new EngineFailure('invalid_input', `assets[${index_}] must be a non-empty asset id`);
      }
      const id = `asset-${index_}`;
      // First ability ships enabled (Rules-Summary p6: "The first ability is
      // enabled when you purchase the asset").
      if (input.index) {
        assets.push(initialAssetInstance(assetId.trim(), id, input.index));
      } else {
        assets.push({
          id,
          assetId: assetId.trim(),
          enabledAbilities: [0],
          optionValues: {},
          meters: {},
          controls: {},
        });
      }
    });
  }
  const campaignTracks: Record<string, ProgressTrack> = {};
  let seq = 0;
  if (input.backgroundVow !== undefined) {
    const { title, rank } = input.backgroundVow;
    if (typeof title !== 'string' || title.trim().length === 0) {
      throw new EngineFailure('invalid_title', 'backgroundVow.title must be a non-empty string');
    }
    if (rank !== null && !(CHALLENGE_RANKS as readonly string[]).includes(rank)) {
      throw new EngineFailure(
        'invalid_rank',
        `backgroundVow.rank must be null or one of ${CHALLENGE_RANKS.join('/')}`,
      );
    }
    campaignTracks[`track-${seq++}`] = { title: title.trim(), rank, kind: 'vow', ticks: 0 };
  }
  const contentFlags: string[] = [];
  if (input.contentFlags !== undefined) {
    if (!Array.isArray(input.contentFlags)) {
      throw new EngineFailure('invalid_input', 'contentFlags must be an array of strings');
    }
    const seen = new Set<string>();
    for (const flag of input.contentFlags) {
      if (typeof flag !== 'string') {
        throw new EngineFailure('invalid_input', 'contentFlags entries must be strings');
      }
      const trimmed = flag.trim();
      if (trimmed.length === 0 || seen.has(trimmed)) continue;
      seen.add(trimmed);
      contentFlags.push(trimmed);
    }
  }
  return {
    version: STATE_VERSION,
    truths: input.truths ? { ...input.truths } : {},
    characters: [character],
    activeCharacterId: character.id,
    tracks: campaignTracks,
    legacy: {
      quests_legacy: { ticks: 0, cleared: false },
      bonds_legacy: { ticks: 0, cleared: false },
      discoveries_legacy: { ticks: 0, cleared: false },
    },
    assets,
    experience: 0,
    contentFlags,
    scene: { index: 1, flags: {}, aboardVehicleAssetIds: [] },
    journal: [],
    momentum: MOMENTUM_START,
    seq,
  };
}

/**
 * Upgrade a persisted campaign to the current shape. Migration chain:
 * v1 → v2 (experience, per-asset controls) → v3 (contentFlags) →
 * v4 (character.background default ''). Idempotent;
 * throws `version_mismatch` on unknown versions or malformed shapes. Like
 * createNewCampaign this is a campaign-level operation outside the event log.
 */
export function migrateCampaignState(raw: CampaignState): CampaignState {
  if (raw.version === STATE_VERSION) return raw;
  const next = structuredClone(raw) as CampaignState;
  if (next.version === 1) {
    next.version = 2;
    next.experience = 0;
    for (const asset of next.assets) {
      asset.controls ??= {};
    }
  }
  if (next.version === 2) {
    next.version = 3;
    next.contentFlags ??= [];
  }
  if (next.version === 3) {
    next.version = 4;
    for (const character of next.characters) {
      character.background ??= '';
    }
  }
  if (next.version !== STATE_VERSION) {
    throw new EngineFailure(
      'version_mismatch',
      `cannot migrate campaign state version ${String(raw.version)} (expected ≤ ${STATE_VERSION})`,
    );
  }
  return next;
}

export function getActiveCharacter(state: CampaignState): CharacterState {
  const character = state.characters.find((c) => c.id === state.activeCharacterId);
  if (!character) {
    throw new EngineFailure('invalid_state', 'active character is missing');
  }
  return character;
}

export function isVehicleImpactCategory(category: string): boolean {
  return category === 'vehicle_troubles';
}

export function countActiveImpacts(
  state: CampaignState,
  character: CharacterState,
  index?: StarforgedIndex,
): number {
  let count = 0;
  for (const impact of character.impacts) {
    if (!isVehicleImpactCategory(impact.category)) {
      count += 1;
      continue;
    }
    if (
      impact.assetId !== undefined &&
      state.scene.aboardVehicleAssetIds.includes(impact.assetId)
    ) {
      count += 1;
    }
  }
  // M5: assets flagged `count_as_impact` (e.g. Oathbreaker) count while owned
  if (index) {
    for (const instance of state.assets) {
      if (index.getAsset(instance.assetId)?.count_as_impact === true) count += 1;
    }
  }
  return count;
}

export function momentumMax(state: CampaignState, index?: StarforgedIndex): number {
  const character = getActiveCharacter(state);
  return Math.max(0, 10 - countActiveImpacts(state, character, index));
}

export function momentumReset(state: CampaignState, index?: StarforgedIndex): number {
  const character = getActiveCharacter(state);
  const count = countActiveImpacts(state, character, index);
  if (count === 0) return 2;
  if (count === 1) return 1;
  return 0;
}

export function isLegacyTrackId(id: string): id is LegacyTrackId {
  return (LEGACY_IDS as readonly string[]).includes(id);
}

export interface ImpactDef {
  category: string;
  impactId: string;
  label: string;
  preventsRecovery: string[];
  permanent: boolean;
  shared: boolean;
}

export function findImpactDef(index: StarforgedIndex, impactId: string): ImpactDef | undefined {
  for (const [category, group] of Object.entries(index.data.rules.impacts)) {
    const def = group.contents[impactId];
    if (def) {
      return {
        category,
        impactId,
        label: def.label,
        preventsRecovery: def.prevents_recovery ?? [],
        permanent: def.permanent ?? false,
        shared: def.shared,
      };
    }
  }
  return undefined;
}

/**
 * Rule correction vs Datasworn 0.0.10: "cursed" is a permanent impact
 * (Rules Summary p5, Primer p21), but Datasworn only flags lasting_effects
 * with `permanent: true`. The engine enforces the rulebook behavior.
 */
export const EXTRA_PERMANENT_IMPACTS: ReadonlySet<string> = new Set(['cursed']);

export function isPermanentImpact(def: ImpactDef): boolean {
  return def.permanent || EXTRA_PERMANENT_IMPACTS.has(def.impactId);
}

export function blockedMeters(state: CampaignState, index: StarforgedIndex): Set<ConditionMeterId> {
  const character = getActiveCharacter(state);
  const blocked = new Set<ConditionMeterId>();
  for (const impact of character.impacts) {
    const def = index.data.rules.impacts[impact.category]?.contents[impact.impactId];
    for (const meter of def?.prevents_recovery ?? []) {
      if ((METER_IDS as readonly string[]).includes(meter)) {
        blocked.add(meter as ConditionMeterId);
      }
    }
  }
  return blocked;
}

export function markedImpact(state: CampaignState, impactId: string): MarkedImpact | undefined {
  return getActiveCharacter(state).impacts.find((i) => i.impactId === impactId);
}

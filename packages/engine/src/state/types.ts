import type { ConditionMeterId, LegacyTrackId, StatId } from '@starwright/data';
import type { EngineOutcome } from '../audit.js';

export const STATE_VERSION = 4;
export const MOMENTUM_MIN = -6;
export const MOMENTUM_START = 2;
export const JOURNAL_LIMIT = 500;

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ChallengeRank = 'troublesome' | 'dangerous' | 'formidable' | 'extreme' | 'epic';

export const CHALLENGE_RANKS: readonly ChallengeRank[] = [
  'troublesome',
  'dangerous',
  'formidable',
  'extreme',
  'epic',
];

export type TrackKind = 'vow' | 'fray' | 'expedition' | 'connection' | 'other';

export interface MarkedImpact {
  impactId: string;
  category: string;
  assetId?: string;
  permanent: boolean;
}

export interface CharacterState {
  id: string;
  name: string;
  /** M6: player-written backstory from the wizard (optional free text, trimmed; '' = unset) */
  background: string;
  stats: Record<StatId, number>;
  meters: Record<ConditionMeterId, number>;
  impacts: MarkedImpact[];
}

export interface ProgressTrack {
  title: string;
  rank: ChallengeRank | null;
  kind: TrackKind;
  ticks: number;
}

export interface LegacyTrack {
  ticks: number;
  cleared: boolean;
}

export interface AssetInstance {
  id: string;
  assetId: string;
  enabledAbilities: number[];
  optionValues: Record<string, string>;
  /** M5: asset condition meters keyed by control key (integrity/health/shields…) */
  meters: Record<string, number>;
  /** M5: checkbox/card_flip controls keyed by control key (battered/broken/out_of_action…) */
  controls: Record<string, boolean>;
  /** M5: instance id of the vehicle this asset is attached to (module → starship) */
  attachedTo?: string;
}

export interface SceneState {
  index: number;
  flags: Record<string, JsonValue>;
  aboardVehicleAssetIds: string[];
}

export interface JournalEntry {
  id: string;
  kind: 'settlement' | 'note';
  sceneIndex: number;
  note?: string;
  outcome?: EngineOutcome;
}

export interface CampaignState {
  version: number;
  truths: Record<string, string>;
  characters: CharacterState[];
  activeCharacterId: string;
  tracks: Record<string, ProgressTrack>;
  legacy: Record<LegacyTrackId, LegacyTrack>;
  assets: AssetInstance[];
  /** M5: earned, unspent experience (auto-accrued when legacy boxes fill) */
  experience: number;
  /**
   * Player-set content flags (Set a Flag, starforged/moves/session/set_a_flag):
   * situations or topics to omit, not envision in detail, or approach
   * mindfully. Established by the player at campaign creation; the GM reads
   * them from the prompt snapshot and has no authority to change them.
   * Distinct from `scene.flags`, which is the GM's narrative working memory.
   */
  contentFlags: string[];
  scene: SceneState;
  journal: JournalEntry[];
  momentum: number;
  seq: number;
}

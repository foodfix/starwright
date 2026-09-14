import type { ConditionMeterId, LegacyTrackId } from '@starwright/data';
import type { EngineEvent } from './events.js';
import type { ActionResult, OutcomeKind, ProgressResult } from './dice/rolls.js';
import type { CampaignState, ChallengeRank, JsonValue, TrackKind } from './state/types.js';

export type { OutcomeKind };

export interface EngineError {
  code: string;
  message: string;
  hint?: string;
}

export interface AuditEntry {
  id: string;
  event: EngineEvent;
  ok: boolean;
  error?: EngineError;
}

export interface ActionRollOutcome extends ActionResult {
  kind: 'action_roll';
  rollId: string;
}

export interface ProgressRollOutcome extends ProgressResult {
  kind: 'progress_roll';
  rollId: string;
  trackId: string;
  ticks: number;
}

export interface BurnMomentumOutcome {
  kind: 'burn_momentum';
  rollId: string;
  result: ActionResult;
  momentumBefore: number;
  momentumAfter: number;
  reset: number;
}

export interface MomentumOutcome {
  kind: 'adjust_momentum';
  delta: number;
  before: number;
  after: number;
  momentumMax: number;
}

export interface MeterOutcome {
  kind: 'adjust_meter';
  meter: ConditionMeterId;
  delta: number;
  before: number;
  after: number;
}

export interface ImpactOutcome {
  kind: 'mark_impact' | 'clear_impact';
  impactId: string;
  impacts: string[];
}

export interface AddTrackOutcome {
  kind: 'add_track';
  trackId: string;
  title: string;
  rank: ChallengeRank | null;
  trackKind: TrackKind;
}

export interface MarkProgressOutcome {
  kind: 'mark_progress';
  trackId: string;
  ticksAdded: number;
  ticks: number;
}

export interface LegacyOutcome {
  kind: 'adjust_legacy';
  legacy: LegacyTrackId;
  ticksAdded: number;
  ticks: number;
  cleared: boolean;
  /** M5: experience granted by newly filled boxes this event (Earn Experience) */
  experienceGained: number;
  /** M5: total unspent experience after this event */
  experience: number;
}

export interface FlagOutcome {
  kind: 'set_flag';
  key: string;
  value: JsonValue;
}

export interface JournalNoteOutcome {
  kind: 'add_journal_entry';
  entryId: string;
}

export interface AboardVehicleOutcome {
  kind: 'set_aboard_vehicle';
  assetIds: string[];
}

export interface EndSceneOutcome {
  kind: 'end_scene';
  sceneIndex: number;
}

/** shared snapshot of an asset instance for asset outcomes */
export interface AssetSnapshot {
  instanceId: string;
  assetId: string;
  name: string;
  enabledAbilities: number[];
  meters: Record<string, number>;
  controls: Record<string, boolean>;
  attachedTo?: string;
}

export interface AddAssetOutcome {
  kind: 'add_asset';
  asset: AssetSnapshot;
  experienceCost: number;
  experience: number;
}

export interface DiscardAssetOutcome {
  kind: 'discard_asset';
  asset: AssetSnapshot;
  clearedImpacts: string[];
}

export interface EnableAbilityOutcome {
  kind: 'enable_ability';
  asset: AssetSnapshot;
  abilityIndex: number;
  experienceCost: number;
  experience: number;
}

export interface AdjustAssetMeterOutcome {
  kind: 'adjust_asset_meter';
  asset: AssetSnapshot;
  control: string;
  delta: number;
  before: number;
  after: number;
}

export interface SetAssetControlOutcome {
  kind: 'set_asset_control';
  asset: AssetSnapshot;
  control: string;
  value: boolean;
}

export interface RemoveTrackOutcome {
  kind: 'remove_track';
  trackId: string;
  title: string;
}

export interface UpdateTrackOutcome {
  kind: 'update_track';
  trackId: string;
  title: string;
  rank: ChallengeRank | null;
  ticks: number;
  ticksBefore?: number;
  rankBefore?: ChallengeRank | null;
}

export type EngineOutcome =
  | ActionRollOutcome
  | ProgressRollOutcome
  | BurnMomentumOutcome
  | MomentumOutcome
  | MeterOutcome
  | ImpactOutcome
  | AddTrackOutcome
  | MarkProgressOutcome
  | LegacyOutcome
  | FlagOutcome
  | JournalNoteOutcome
  | AboardVehicleOutcome
  | EndSceneOutcome
  | AddAssetOutcome
  | DiscardAssetOutcome
  | EnableAbilityOutcome
  | AdjustAssetMeterOutcome
  | SetAssetControlOutcome
  | RemoveTrackOutcome
  | UpdateTrackOutcome;

export interface ReduceSuccess {
  ok: true;
  state: CampaignState;
  outcome: EngineOutcome;
  log: AuditEntry;
}

export interface ReduceFailure {
  ok: false;
  state: CampaignState;
  error: EngineError;
  log: AuditEntry;
}

export type ReduceResult = ReduceSuccess | ReduceFailure;

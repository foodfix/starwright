import type { ConditionMeterId, LegacyTrackId, StatId } from '@starwright/data';
import type { AssetMeterSelection } from './dice/rolls.js';
import type { ChallengeRank, JsonValue, TrackKind } from './state/types.js';

export type EngineEvent =
  | {
      type: 'action_roll';
      stat?: StatId;
      meter?: ConditionMeterId;
      /** M5: roll with an asset condition meter (asset_control triggers) */
      assetMeter?: AssetMeterSelection;
      add?: number;
    }
  | { type: 'progress_roll'; trackId: string }
  | { type: 'burn_momentum'; rollId: string }
  | { type: 'adjust_momentum'; delta: number }
  | { type: 'adjust_meter'; meter: ConditionMeterId; delta: number }
  | { type: 'mark_impact'; impactId: string; assetId?: string }
  | { type: 'clear_impact'; impactId: string }
  | { type: 'add_track'; title: string; rank: ChallengeRank | null; kind?: TrackKind }
  | { type: 'mark_progress'; trackId: string; marks?: number; ticks?: number }
  | { type: 'adjust_legacy'; legacy: LegacyTrackId; ticks: number }
  | { type: 'set_flag'; key: string; value: JsonValue }
  | { type: 'add_journal_entry'; text: string }
  | { type: 'set_aboard_vehicle'; assetIds: string[] }
  | { type: 'end_scene' }
  // M5: asset automation
  | { type: 'add_asset'; assetId: string; payWithExperience?: boolean; attachTo?: string }
  | { type: 'discard_asset'; assetId: string }
  | {
      type: 'enable_ability';
      assetId: string;
      abilityIndex: number;
      payWithExperience?: boolean;
      requirementConfirmed?: boolean;
    }
  | { type: 'adjust_asset_meter'; assetId: string; control: string; delta: number }
  | { type: 'set_asset_control'; assetId: string; control: string; value: boolean }
  // M5: track lifecycle
  | { type: 'remove_track'; trackId: string }
  | { type: 'update_track'; trackId: string; title?: string; rank?: ChallengeRank; ticks?: number };

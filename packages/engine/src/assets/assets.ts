import type { Asset, AssetControl, LegacyTrackId, StarforgedIndex } from '@starwright/data';
import type { AssetInstance, CampaignState } from '../state/types.js';
import { EngineFailure } from '../state/create.js';

export interface AssetControlInfo {
  key: string;
  label: string;
  fieldType: 'condition_meter' | 'checkbox' | 'card_flip';
  min?: number;
  max?: number;
  value?: number | boolean;
  isImpact: boolean;
  disablesAsset: boolean;
}

/** Flat leaf-key map of an asset's controls (keys are unique within an asset). */
export function assetControlInfos(def: Asset): Map<string, AssetControlInfo> {
  const infos = new Map<string, AssetControlInfo>();
  const walk = (key: string, control: AssetControl): void => {
    infos.set(key, {
      key,
      label: control.label,
      fieldType: control.field_type,
      min: control.min,
      max: control.max,
      value: control.value,
      isImpact: control['is_impact'] === true,
      disablesAsset: control['disables_asset'] === true,
    });
    for (const [childKey, child] of Object.entries(control.controls ?? {})) {
      walk(childKey, child);
    }
  };
  for (const [key, control] of Object.entries(def.controls ?? {})) {
    walk(key, control);
  }
  return infos;
}

export function meterControlInfo(def: Asset, key: string): AssetControlInfo {
  const info = assetControlInfos(def).get(key);
  if (!info || info.fieldType !== 'condition_meter') {
    throw new EngineFailure(
      'asset_control_missing',
      `asset "${def._id}" has no condition meter "${key}"`,
      `valid meters: ${
        [...assetControlInfos(def).values()]
          .filter((c) => c.fieldType === 'condition_meter')
          .map((c) => c.key)
          .join(', ') || 'none'
      }`,
    );
  }
  return info;
}

/**
 * Keys of `is_impact` sub-controls attached to a meter (e.g. battered/cursed
 * under integrity). Marking any of them blocks raising the meter.
 */
export function impactControlsUnderMeter(def: Asset, key: string): string[] {
  const control = def.controls?.[key];
  return Object.entries(control?.controls ?? {})
    .filter(([, child]) => child['is_impact'] === true)
    .map(([childKey]) => childKey);
}

/** Initial instance state: first ability enabled, meters/controls from the definition. */
export function initialAssetInstance(
  assetId: string,
  id: string,
  index: StarforgedIndex,
): AssetInstance {
  const def = index.getAsset(assetId);
  if (!def) {
    throw new EngineFailure(
      'unknown_asset',
      `asset "${assetId}" not found in the catalog`,
      'use an id from the asset catalog (e.g. starforged/assets/command_vehicle/starship)',
    );
  }
  const instance: AssetInstance = {
    id,
    assetId,
    enabledAbilities: [0],
    optionValues: {},
    meters: {},
    controls: {},
  };
  for (const info of assetControlInfos(def).values()) {
    if (info.fieldType === 'condition_meter') {
      instance.meters[info.key] = typeof info.value === 'number' ? info.value : (info.min ?? 0);
    } else {
      instance.controls[info.key] = false;
    }
  }
  return instance;
}

export function getAssetInstance(state: CampaignState, instanceId: string): AssetInstance {
  const instance = state.assets.find((a) => a.id === instanceId);
  if (!instance) {
    throw new EngineFailure(
      'unknown_asset',
      `asset instance "${instanceId}" not found`,
      'use the instance id from the ASSETS snapshot line',
    );
  }
  return instance;
}

/** true when a control with `disables_asset` (out_of_action/broken) is set */
export function assetDisabled(instance: AssetInstance, index: StarforgedIndex): boolean {
  const def = index.getAsset(instance.assetId);
  if (!def) return false;
  for (const info of assetControlInfos(def).values()) {
    if (info.disablesAsset && instance.controls[info.key] === true) return true;
  }
  return false;
}

const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

// '*' wildcard match on one path segment, e.g. starforged/moves/ANY/face_danger
export function globMatch(pattern: string, id: string): boolean {
  if (!pattern.includes('*')) return pattern === id;
  const parts = pattern.split('*').map((part) => part.replace(ESCAPE_REGEX, '\\$&'));
  const regex = new RegExp('^' + parts.join('[^/]+') + '$');
  return regex.test(id);
}

export function instanceMatchesAssetPatterns(
  instance: AssetInstance,
  patterns: string[] | null | undefined,
): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((pattern) => globMatch(pattern, instance.assetId));
}

export interface Enhancement {
  instanceId: string;
  assetId: string;
  assetName: string;
  abilityIndex: number;
  /** trigger/condition text of the enhancement entry */
  text: string;
  /** full ability text (the rule the player follows when applying it) */
  abilityText: string;
}

interface EnhanceMoveShape {
  enhances?: string[] | null;
  trigger?: { conditions?: Array<{ text?: string }> | null } | null;
}

/**
 * Collect the optional modifiers offered by enabled abilities of owned assets
 * for the given move. The engine never applies them automatically.
 */
export function listEnhancements(
  state: CampaignState,
  index: StarforgedIndex,
  moveId: string,
): Enhancement[] {
  const enhancements: Enhancement[] = [];
  for (const instance of state.assets) {
    const def = index.getAsset(instance.assetId);
    if (!def) continue;
    if (assetDisabled(instance, index)) continue;
    for (const abilityIndex of instance.enabledAbilities) {
      const ability = def.abilities[abilityIndex];
      for (const enhance of (ability?.enhance_moves ?? []) as EnhanceMoveShape[]) {
        const hits = (enhance.enhances ?? []).some((pattern) => globMatch(pattern, moveId));
        if (!hits) continue;
        const text =
          enhance.trigger?.conditions?.map((condition) => condition.text ?? '').join('; ') ?? '';
        enhancements.push({
          instanceId: instance.id,
          assetId: instance.assetId,
          assetName: def.name,
          abilityIndex,
          text: text || def.abilities[abilityIndex]?.text.slice(0, 160) || '',
          abilityText: ability?.text ?? '',
        });
      }
    }
  }
  return enhancements;
}

/**
 * Structured subset of asset `requirement` texts: "…fill N boxes on your
 * <track> legacy track". Everything else is narrative and confirmed by the GM.
 */
export function legacyRequirement(
  def: Asset,
): { legacy: LegacyTrackId; boxes: number } | undefined {
  const match = /fill (\d+) boxes on your (quests|bonds|discoveries) legacy track/i.exec(
    def.requirement ?? '',
  );
  if (!match?.[1] || !match[2]) return undefined;
  return { legacy: `${match[2]}_legacy` as LegacyTrackId, boxes: Number(match[1]) };
}

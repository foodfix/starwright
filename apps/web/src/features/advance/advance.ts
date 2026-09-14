import {
  ADD_ASSET_COST,
  ENABLE_ABILITY_COST,
  legacyRequirement,
  type AssetInstance,
  type CampaignState,
} from '@starwright/engine';
import type { Asset, LegacyTrackId, StarforgedIndex } from '@starwright/data';

export type AdvanceBlockReason = 'unavailable' | 'insufficient_xp' | 'legacy_boxes';

export interface AdvanceReadiness {
  ok: boolean;
  reason?: AdvanceBlockReason;
  legacyGap?: { legacy: LegacyTrackId; need: number; have: number };
  /** narrative requirement text; cleared by the player's explicit confirmation */
  narrativeRequirement?: string;
}

export interface UpgradeCandidate {
  instance: AssetInstance;
  name: string;
  abilities: Array<{ abilityIndex: number; text: string }>;
}

function xpBlocked(state: CampaignState, cost: number): AdvanceReadiness | undefined {
  if (state.experience >= cost) return undefined;
  return { ok: false, reason: 'insufficient_xp' };
}

/** mirrors the engine's requirement handling (reducer.ts handleEnableAbility) */
function requirementBlocked(
  state: CampaignState,
  def: Asset,
  confirmed: boolean,
): AdvanceReadiness | undefined {
  const legacy = legacyRequirement(def);
  if (legacy) {
    const have = Math.floor(state.legacy[legacy.legacy].ticks / 4);
    if (have < legacy.boxes) {
      return {
        ok: false,
        reason: 'legacy_boxes',
        legacyGap: { legacy: legacy.legacy, need: legacy.boxes, have },
      };
    }
    return undefined;
  }
  if (def.requirement && !confirmed) {
    return { ok: false, narrativeRequirement: def.requirement };
  }
  return undefined;
}

export function buyReadiness(
  state: CampaignState,
  index: StarforgedIndex,
  assetId: string,
  requirementConfirmed = false,
): AdvanceReadiness {
  const def = index.getAsset(assetId);
  if (!def) return { ok: false, reason: 'unavailable' };
  return (
    xpBlocked(state, ADD_ASSET_COST) ??
    requirementBlocked(state, def, requirementConfirmed) ?? { ok: true }
  );
}

export function upgradeReadiness(
  state: CampaignState,
  index: StarforgedIndex,
  instanceId: string,
  abilityIndex: number,
  requirementConfirmed = false,
): AdvanceReadiness {
  const instance = state.assets.find((a) => a.id === instanceId);
  const def = instance ? index.getAsset(instance.assetId) : undefined;
  if (!instance || !def) return { ok: false, reason: 'unavailable' };
  if (!def.abilities[abilityIndex] || instance.enabledAbilities.includes(abilityIndex)) {
    return { ok: false, reason: 'unavailable' };
  }
  return (
    xpBlocked(state, ENABLE_ABILITY_COST) ??
    requirementBlocked(state, def, requirementConfirmed) ?? { ok: true }
  );
}

export function purchasableTree(state: CampaignState, index: StarforgedIndex) {
  const owned = new Set(state.assets.map((a) => a.assetId));
  return index
    .listAssetTree()
    .map((category) => ({
      ...category,
      assets: category.assets.filter((entry) => !owned.has(entry.id)),
    }))
    .filter((category) => category.assets.length > 0);
}

export function upgradeCandidates(
  state: CampaignState,
  index: StarforgedIndex,
): UpgradeCandidate[] {
  const candidates: UpgradeCandidate[] = [];
  for (const instance of state.assets) {
    const def = index.getAsset(instance.assetId);
    if (!def) continue;
    const abilities = def.abilities
      .map((ability, abilityIndex) => ({ abilityIndex, text: ability.text }))
      .filter(({ abilityIndex }) => !instance.enabledAbilities.includes(abilityIndex));
    if (abilities.length === 0) continue;
    candidates.push({ instance, name: def.name, abilities });
  }
  return candidates;
}

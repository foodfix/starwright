import { describe, expect, it } from 'vitest';
import { createNewCampaign, type CampaignState } from '@starwright/engine';
import type { Asset, AssetCatalogEntry, AssetCategoryNode, StarforgedIndex } from '@starwright/data';
import { buyReadiness, purchasableTree, upgradeCandidates, upgradeReadiness } from './advance.js';

const PLAIN = 'starforged/assets/companion/robot';
const DEED_LEGACY = 'starforged/assets/deed/vanguard';
const DEED_STORY = 'starforged/assets/deed/overlord';

const DEFS: Record<string, Asset> = {
  [PLAIN]: {
    _id: PLAIN,
    type: 'asset',
    name: 'Robot',
    category: 'Companion',
    abilities: [
      { _id: `${PLAIN}/abilities/0`, enabled: true, text: 'Your robot companion…' },
      { _id: `${PLAIN}/abilities/1`, enabled: false, text: 'Improved sensors.' },
      { _id: `${PLAIN}/abilities/2`, enabled: false, text: 'Weaponized chassis.' },
    ],
  },
  [DEED_LEGACY]: {
    _id: DEED_LEGACY,
    type: 'asset',
    name: 'Vanguard',
    category: 'Deed',
    requirement: 'Once you fill 2 boxes on your quests legacy track…',
    abilities: [{ _id: `${DEED_LEGACY}/abilities/0`, enabled: true, text: 'Once you…' }],
  },
  [DEED_STORY]: {
    _id: DEED_STORY,
    type: 'asset',
    name: 'Overlord',
    category: 'Deed',
    requirement: 'Once you face the finale of a quest…',
    abilities: [
      { _id: `${DEED_STORY}/abilities/0`, enabled: true, text: 'Once you…' },
      { _id: `${DEED_STORY}/abilities/1`, enabled: false, text: 'Their reign ends.' },
    ],
  },
};

const TREE: AssetCategoryNode[] = [
  {
    id: 'starforged/assets/companion',
    name: 'Companion',
    assets: [entry(PLAIN, 'Robot', 'Companion')],
  },
  {
    id: 'starforged/assets/deed',
    name: 'Deed',
    assets: [entry(DEED_LEGACY, 'Vanguard', 'Deed'), entry(DEED_STORY, 'Overlord', 'Deed')],
  },
];

function entry(id: string, name: string, category: string): AssetCatalogEntry {
  return { id, name, category, firstAbility: 'Once you…', optionLabels: [] };
}

const index = {
  getAsset: (id: string) => DEFS[id],
  listAssetTree: () => TREE,
} as unknown as StarforgedIndex;

function state(): CampaignState {
  return createNewCampaign({
    characterName: 'Rav',
    stats: { edge: 3, heart: 2, iron: 2, shadow: 1, wits: 1 },
    index,
  });
}

function withInstance(
  s: CampaignState,
  assetId: string,
  enabledAbilities: number[],
): CampaignState {
  return {
    ...s,
    assets: [
      ...s.assets,
      { id: 'asset-9', assetId, enabledAbilities, optionValues: {}, meters: {}, controls: {} },
    ],
  };
}

describe('buyReadiness', () => {
  it('blocks a plain asset when XP is below the asset price', () => {
    const s = { ...state(), experience: 2 };
    expect(buyReadiness(s, index, PLAIN)).toEqual({ ok: false, reason: 'insufficient_xp' });
  });

  it('allows a plain asset when XP is sufficient', () => {
    const s = { ...state(), experience: 3 };
    expect(buyReadiness(s, index, PLAIN)).toEqual({ ok: true });
  });

  it('blocks deed assets with unmet legacy boxes and reports the gap', () => {
    const s = { ...state(), experience: 5 };
    const result = buyReadiness(s, index, DEED_LEGACY);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('legacy_boxes');
    expect(result.legacyGap).toEqual({ legacy: 'quests_legacy', need: 2, have: 0 });
  });

  it('allows deed assets once the legacy boxes are filled', () => {
    const s = state();
    s.legacy.quests_legacy.ticks = 8; // 2 boxes
    s.experience = 3;
    expect(buyReadiness(s, index, DEED_LEGACY)).toEqual({ ok: true });
  });

  it('gates narrative-requirement deeds behind explicit confirmation', () => {
    const s = { ...state(), experience: 5 };
    const unconfirmed = buyReadiness(s, index, DEED_STORY);
    expect(unconfirmed.ok).toBe(false);
    expect(unconfirmed.narrativeRequirement).toContain('finale');
    expect(buyReadiness(s, index, DEED_STORY, true)).toEqual({ ok: true });
  });
});

describe('upgradeReadiness', () => {
  it('blocks an already-enabled ability', () => {
    const s = withInstance({ ...state(), experience: 9 }, PLAIN, [0]);
    expect(upgradeReadiness(s, index, 'asset-9', 0)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('blocks a locked ability when XP is insufficient', () => {
    const s = withInstance({ ...state(), experience: 1 }, PLAIN, [0]);
    expect(upgradeReadiness(s, index, 'asset-9', 1)).toEqual({
      ok: false,
      reason: 'insufficient_xp',
    });
  });

  it('allows a locked ability when XP is sufficient', () => {
    const s = withInstance({ ...state(), experience: 2 }, PLAIN, [0]);
    expect(upgradeReadiness(s, index, 'asset-9', 1)).toEqual({ ok: true });
  });

  it('requires confirmation for a narrative requirement on the owning asset', () => {
    const s = withInstance({ ...state(), experience: 9 }, DEED_STORY, [0]);
    const unconfirmed = upgradeReadiness(s, index, 'asset-9', 1);
    expect(unconfirmed.ok).toBe(false);
    expect(unconfirmed.narrativeRequirement).toBeTruthy();
    expect(upgradeReadiness(s, index, 'asset-9', 1, true)).toEqual({ ok: true });
  });
});

describe('purchasableTree', () => {
  it('excludes owned assets and categories left empty', () => {
    const s = withInstance(state(), PLAIN, [0]);
    const tree = purchasableTree(s, index);
    const ids = tree.flatMap((category) => category.assets.map((a) => a.id));
    expect(ids).toEqual([DEED_LEGACY, DEED_STORY]);
  });
});

describe('upgradeCandidates', () => {
  it('lists only locked abilities and skips fully enabled assets', () => {
    const s = withInstance(withInstance(state(), PLAIN, [0, 1]), DEED_STORY, [0, 1]);
    const candidates = upgradeCandidates(s, index);
    expect(candidates.map((c) => c.name)).toEqual(['Robot']);
    expect(candidates[0]!.abilities.map((a) => a.abilityIndex)).toEqual([2]);
  });
});

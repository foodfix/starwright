import { describe, expect, it } from 'vitest';
import type { ConditionMeterId, StatId, StarforgedIndex } from '@starwright/data';
import {
  createNewCampaign,
  momentumMax,
  momentumReset,
  countActiveImpacts,
  findImpactDef,
  isPermanentImpact,
  blockedMeters,
  EngineFailure,
} from './state/create.js';
import { realIndex } from './test-support.js';

const STATS: Record<StatId, number> = { edge: 2, heart: 3, iron: 1, shadow: 1, wits: 2 };

function failureOf(fn: () => unknown): EngineFailure {
  try {
    fn();
  } catch (e) {
    if (e instanceof EngineFailure) return e;
    throw e;
  }
  throw new Error('expected EngineFailure');
}

describe('createNewCampaign', () => {
  it('builds the default state', () => {
    const state = createNewCampaign({ characterName: '  Raven  ', stats: STATS });
    expect(state.version).toBe(4);
    expect(state.experience).toBe(0);
    expect(state.contentFlags).toEqual([]);
    expect(state.characters).toHaveLength(1);
    expect(state.characters[0]?.name).toBe('Raven');
    expect(state.characters[0]?.background).toBe('');
    expect(state.characters[0]?.meters).toEqual({ health: 5, spirit: 5, supply: 5 });
    expect(state.momentum).toBe(2);
    expect(Object.keys(state.legacy).sort()).toEqual([
      'bonds_legacy',
      'discoveries_legacy',
      'quests_legacy',
    ]);
    expect(state.scene.index).toBe(1);
    expect(state.journal).toEqual([]);
    expect(state.seq).toBe(0);
  });

  it('rejects invalid stats and names', () => {
    expect(failureOf(() => createNewCampaign({ characterName: '', stats: STATS })).code).toBe(
      'invalid_input',
    );
    expect(
      failureOf(() => createNewCampaign({ characterName: 'X', stats: { ...STATS, edge: 6 } })).code,
    ).toBe('invalid_input');
    expect(
      failureOf(() => createNewCampaign({ characterName: 'X', stats: { ...STATS, wits: 1.5 } }))
        .code,
    ).toBe('invalid_input');
  });

  it('normalizes content flags (trim, drop empties, dedupe)', () => {
    const state = createNewCampaign({
      characterName: 'X',
      stats: STATS,
      contentFlags: ['  graphic body horror ', '', 'graphic body horror', '  ', 'torture'],
    });
    expect(state.contentFlags).toEqual(['graphic body horror', 'torture']);
  });

  it('rejects malformed content flags', () => {
    expect(
      failureOf(() =>
        createNewCampaign({
          characterName: 'X',
          stats: STATS,
          contentFlags: 'body horror' as unknown as string[],
        }),
      ).code,
    ).toBe('invalid_input');
    expect(
      failureOf(() =>
        createNewCampaign({
          characterName: 'X',
          stats: STATS,
          contentFlags: [42] as unknown as string[],
        }),
      ).code,
    ).toBe('invalid_input');
  });

  it('accepts truth selections', () => {
    const state = createNewCampaign({
      characterName: 'Raven',
      stats: STATS,
      truths: { cataclysm: '1' },
    });
    expect(state.truths).toEqual({ cataclysm: '1' });
  });

  it('instantiates initial assets with the first ability enabled (M4)', () => {
    const starship = 'starforged/assets/command_vehicle/starship';
    const path = 'starforged/assets/path/veteran';
    const state = createNewCampaign({
      characterName: 'Raven',
      stats: STATS,
      assets: [starship, path],
    });
    expect(state.assets).toEqual([
      {
        id: 'asset-0',
        assetId: starship,
        enabledAbilities: [0],
        optionValues: {},
        meters: {},
        controls: {},
      },
      {
        id: 'asset-1',
        assetId: path,
        enabledAbilities: [0],
        optionValues: {},
        meters: {},
        controls: {},
      },
    ]);
    expect(state.seq).toBe(0);
  });

  it('materializes the background vow as the first track and advances seq (M4)', () => {
    const state = createNewCampaign({
      characterName: 'Raven',
      stats: STATS,
      backgroundVow: { title: ' Find my sister ', rank: 'dangerous' },
    });
    expect(state.tracks['track-0']).toEqual({
      title: 'Find my sister',
      rank: 'dangerous',
      kind: 'vow',
      ticks: 0,
    });
    expect(state.seq).toBe(1);
    const withBoth = createNewCampaign({
      characterName: 'Raven',
      stats: STATS,
      assets: ['starforged/assets/command_vehicle/starship'],
      backgroundVow: { title: 'Vow', rank: null },
    });
    expect(Object.keys(withBoth.tracks)).toEqual(['track-0']);
    expect(withBoth.tracks['track-0']).toMatchObject({ rank: null, kind: 'vow' });
  });

  it('rejects invalid initial assets and background vows (M4)', () => {
    expect(
      failureOf(() => createNewCampaign({ characterName: 'R', stats: STATS, assets: [' '] })).code,
    ).toBe('invalid_input');
    expect(
      failureOf(() =>
        createNewCampaign({
          characterName: 'R',
          stats: STATS,
          backgroundVow: { title: '', rank: 'dangerous' },
        }),
      ).code,
    ).toBe('invalid_title');
    expect(
      failureOf(() =>
        createNewCampaign({
          characterName: 'R',
          stats: STATS,
          backgroundVow: { title: 'Vow', rank: 'legendary' as 'epic' },
        }),
      ).code,
    ).toBe('invalid_rank');
  });
});

describe('momentum derivation', () => {
  it('derives max and reset from active impacts', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    expect(momentumMax(state)).toBe(10);
    expect(momentumReset(state)).toBe(2);

    state.characters[0]?.impacts.push({
      impactId: 'wounded',
      category: 'misfortunes',
      permanent: false,
    });
    expect(momentumMax(state)).toBe(9);
    expect(momentumReset(state)).toBe(1);

    state.characters[0]?.impacts.push({
      impactId: 'shaken',
      category: 'misfortunes',
      permanent: false,
    });
    expect(momentumMax(state)).toBe(8);
    expect(momentumReset(state)).toBe(0);

    state.characters[0]?.impacts.push({
      impactId: 'doomed',
      category: 'burdens',
      permanent: false,
    });
    state.characters[0]?.impacts.push({
      impactId: 'tormented',
      category: 'burdens',
      permanent: false,
    });
    expect(momentumMax(state)).toBe(6);
    expect(momentumReset(state)).toBe(0);
  });

  it('counts vehicle troubles only while aboard that vehicle', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    state.characters[0]?.impacts.push({
      impactId: 'battered',
      category: 'vehicle_troubles',
      assetId: 'starforged/assets/command_vehicle/starship',
      permanent: false,
    });
    expect(countActiveImpacts(state, state.characters[0]!)).toBe(0);
    expect(momentumMax(state)).toBe(10);
    state.scene.aboardVehicleAssetIds = ['starforged/assets/command_vehicle/starship'];
    expect(countActiveImpacts(state, state.characters[0]!)).toBe(1);
    expect(momentumMax(state)).toBe(9);
    expect(momentumReset(state)).toBe(1);
  });

  it('floors momentum max at 0', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const character = state.characters[0]!;
    for (const [impactId, category] of [
      ['wounded', 'misfortunes'],
      ['shaken', 'misfortunes'],
      ['unprepared', 'misfortunes'],
      ['doomed', 'burdens'],
      ['tormented', 'burdens'],
      ['indebted', 'burdens'],
      ['permanently_harmed', 'lasting_effects'],
      ['traumatized', 'lasting_effects'],
      ['battered', 'vehicle_troubles'],
      ['cursed', 'vehicle_troubles'],
    ] as const) {
      character.impacts.push({
        impactId,
        category,
        permanent: false,
        ...(category === 'vehicle_troubles' ? { assetId: 'v1' } : {}),
      });
    }
    state.scene.aboardVehicleAssetIds = ['v1'];
    expect(countActiveImpacts(state, character)).toBe(10);
    expect(momentumMax(state)).toBe(0);
  });
});

describe('impact definitions from Datasworn', () => {
  it('resolves impact defs with recovery blocking', () => {
    const wounded = findImpactDef(realIndex, 'wounded');
    expect(wounded?.category).toBe('misfortunes');
    expect(wounded?.preventsRecovery).toEqual(['health']);
    expect(isPermanentImpact(wounded!)).toBe(false);
  });

  it('treats lasting effects and cursed as permanent', () => {
    expect(isPermanentImpact(findImpactDef(realIndex, 'permanently_harmed')!)).toBe(true);
    expect(isPermanentImpact(findImpactDef(realIndex, 'traumatized')!)).toBe(true);
    expect(isPermanentImpact(findImpactDef(realIndex, 'cursed')!)).toBe(true);
    expect(isPermanentImpact(findImpactDef(realIndex, 'battered')!)).toBe(false);
  });

  it('blocks meters via prevents_recovery', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    state.characters[0]?.impacts.push({
      impactId: 'shaken',
      category: 'misfortunes',
      permanent: false,
    });
    expect(blockedMeters(state, realIndex)).toEqual(new Set<ConditionMeterId>(['spirit']));
  });

  it('returns undefined for unknown impacts', () => {
    expect(findImpactDef(realIndex, 'nonexistent')).toBeUndefined();
  });
});

describe('stub index typing', () => {
  it('accepts a minimal index for pure tests', () => {
    const stub = {
      data: { rules: { impacts: {} } },
    } as unknown as StarforgedIndex;
    expect(blockedMeters(createNewCampaign({ characterName: 'R', stats: STATS }), stub).size).toBe(
      0,
    );
  });
});

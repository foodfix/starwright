import { describe, expect, it } from 'vitest';
import type { StatId } from '@starwright/data';
import { mulberry32 } from './dice/rng.js';
import {
  createNewCampaign,
  migrateCampaignState,
  momentumMax,
  momentumReset,
} from './state/create.js';
import { reduce, type EngineContext } from './reducer.js';
import type { EngineEvent } from './events.js';
import { legacyRewardTicks, progressScore } from './tracks/tracks.js';
import {
  assetControlInfos,
  assetDisabled,
  legacyRequirement,
  listEnhancements,
} from './assets/assets.js';
import { realIndex } from './test-support.js';
import type { EngineOutcome, ReduceResult } from './audit.js';
import type { ActionRollOutcome } from './audit.js';

const STATS: Record<StatId, number> = { edge: 2, heart: 3, iron: 1, shadow: 1, wits: 2 };
const SEED = 4242;

const ctx: EngineContext = { index: realIndex, rng: mulberry32(SEED) };

const STARSHIP = 'starforged/assets/command_vehicle/starship';
const BANSHEE = 'starforged/assets/companion/banshee';
const SHIELDS = 'starforged/assets/module/shields';
const VETERAN = 'starforged/assets/path/veteran';
const HOMESTEADER = 'starforged/assets/deed/homesteader';
const BONDED = 'starforged/assets/deed/bonded';
const OATHBREAKER = 'starforged/assets/deed/oathbreaker';

function campaign() {
  return createNewCampaign({ characterName: 'Raven', stats: STATS });
}

function run(state: ReturnType<typeof campaign>, event: EngineEvent) {
  return reduce(state, event, ctx);
}

function failureCode(result: ReturnType<typeof run>): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected failure');
  return result.error.code;
}

function stateOf<K extends EngineOutcome['kind']>(result: ReduceResult, kind: K) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  expect(result.outcome.kind).toBe(kind);
  return result.state;
}

function outcomeOf<K extends EngineOutcome['kind']>(
  result: ReturnType<typeof run>,
  kind: K,
): Extract<EngineOutcome, { kind: K }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  expect(result.outcome.kind).toBe(kind);
  return result.outcome as Extract<EngineOutcome, { kind: K }>;
}

function addAsset(assetId: string) {
  let state = campaign();
  const result = run(state, { type: 'add_asset', assetId });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('add_asset failed');
  state = result.state;
  const outcome = outcomeOf(result, 'add_asset');
  return {
    state,
    outcome,
    instanceId: outcome.asset.instanceId,
  };
}

describe('asset instantiation (M5)', () => {
  it('initializes meters and controls from the definition', () => {
    const { state, instanceId, outcome } = addAsset(BANSHEE);
    expect(outcome.experienceCost).toBe(0);
    const instance = state.assets.find((a) => a.id === instanceId)!;
    expect(instance.meters).toEqual({ health: 4 });
    expect(instance.controls).toEqual({ out_of_action: false });
    const def = realIndex.getAsset(BANSHEE)!;
    const infos = assetControlInfos(def);
    expect(infos.get('health')?.max).toBe(4);
    expect(infos.get('out_of_action')?.disablesAsset).toBe(true);
  });

  it('creates a starship with integrity 5 and battered/cursed controls', () => {
    const { state, instanceId } = addAsset(STARSHIP);
    const instance = state.assets.find((a) => a.id === instanceId)!;
    expect(instance.meters).toEqual({ integrity: 5 });
    expect(instance.controls).toEqual({ battered: false, cursed: false });
  });

  it('charges 3 experience for paid purchases and rejects when broke', () => {
    const { state } = addAsset(VETERAN);
    expect(state.experience).toBe(0);
    expect(
      failureCode(run(state, { type: 'add_asset', assetId: BANSHEE, payWithExperience: true })),
    ).toBe('insufficient_experience');
    const funded = stateOf(
      run(state, { type: 'adjust_legacy', legacy: 'quests_legacy', ticks: 8 }),
      'adjust_legacy',
    );
    expect(funded.experience).toBe(4);
    const bought = run(funded, { type: 'add_asset', assetId: BANSHEE, payWithExperience: true });
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.outcome).toMatchObject({ experienceCost: 3, experience: 1 });
  });

  it('rejects unknown assets and invalid attachments', () => {
    expect(failureCode(run(campaign(), { type: 'add_asset', assetId: 'nope' }))).toBe(
      'unknown_asset',
    );
    const host = addAsset(STARSHIP);
    expect(
      failureCode(
        run(host.state, { type: 'add_asset', assetId: VETERAN, attachTo: host.instanceId }),
      ),
    ).toBe('invalid_attachment');
    const ok = outcomeOf(
      run(host.state, { type: 'add_asset', assetId: SHIELDS, attachTo: host.instanceId }),
      'add_asset',
    );
    expect(ok.asset.attachedTo).toBe(host.instanceId);
  });
});

describe('asset ability unlocking (M5)', () => {
  it('unlocks the second ability for 2 experience', () => {
    let state = campaign();
    state = stateOf(run(state, { type: 'add_asset', assetId: STARSHIP }), 'add_asset');
    state = stateOf(
      run(state, { type: 'adjust_legacy', legacy: 'quests_legacy', ticks: 8 }),
      'adjust_legacy',
    );
    const instance = state.assets.at(-1)!.id;
    const unlocked = run(state, {
      type: 'enable_ability',
      assetId: instance,
      abilityIndex: 2,
      payWithExperience: true,
    });
    expect(unlocked.ok).toBe(true);
    if (!unlocked.ok) return;
    expect(unlocked.outcome).toMatchObject({ abilityIndex: 2, experienceCost: 2, experience: 2 });
    expect(unlocked.state.assets.at(-1)!.enabledAbilities).toEqual([0, 2]);
  });

  it('enforces legacy-box requirements without confirmation', () => {
    const { state, instanceId } = addAsset(HOMESTEADER);
    expect(legacyRequirement(realIndex.getAsset(HOMESTEADER)!)).toEqual({
      legacy: 'bonds_legacy',
      boxes: 4,
    });
    const short = stateOf(
      run(state, { type: 'adjust_legacy', legacy: 'bonds_legacy', ticks: 15 }),
      'adjust_legacy',
    );
    expect(
      failureCode(run(short, { type: 'enable_ability', assetId: instanceId, abilityIndex: 1 })),
    ).toBe('requirement_unmet');
    const met = stateOf(
      run(short, { type: 'adjust_legacy', legacy: 'bonds_legacy', ticks: 1 }),
      'adjust_legacy',
    );
    expect(run(met, { type: 'enable_ability', assetId: instanceId, abilityIndex: 1 }).ok).toBe(
      true,
    );
  });

  it('requires narrative confirmation when no structured requirement parses', () => {
    const { state, instanceId } = addAsset(BONDED);
    expect(realIndex.getAsset(BONDED)!.requirement).toContain('Forge a Bond');
    expect(
      failureCode(run(state, { type: 'enable_ability', assetId: instanceId, abilityIndex: 1 })),
    ).toBe('requirement_confirmation_required');
    expect(
      run(state, {
        type: 'enable_ability',
        assetId: instanceId,
        abilityIndex: 1,
        requirementConfirmed: true,
      }).ok,
    ).toBe(true);
  });

  it('rejects duplicate unlocks and unknown abilities', () => {
    const { state, instanceId } = addAsset(STARSHIP);
    expect(
      failureCode(run(state, { type: 'enable_ability', assetId: instanceId, abilityIndex: 0 })),
    ).toBe('ability_already_enabled');
    expect(
      failureCode(run(state, { type: 'enable_ability', assetId: instanceId, abilityIndex: 9 })),
    ).toBe('ability_not_found');
  });
});

describe('asset meters and controls (M5)', () => {
  it('adjusts within [min, max]', () => {
    const { state, instanceId } = addAsset(BANSHEE);
    const hit = run(state, {
      type: 'adjust_asset_meter',
      assetId: instanceId,
      control: 'health',
      delta: -3,
    });
    expect(hit.ok).toBe(true);
    if (!hit.ok) return;
    expect(hit.outcome).toMatchObject({ before: 4, after: 1 });
    const floorResult = run(hit.state, {
      type: 'adjust_asset_meter',
      assetId: instanceId,
      control: 'health',
      delta: -5,
    });
    const floor = outcomeOf(floorResult, 'adjust_asset_meter');
    expect(floor.after).toBe(0);
    const cap = outcomeOf(
      run(floorResult.state, {
        type: 'adjust_asset_meter',
        assetId: instanceId,
        control: 'health',
        delta: 9,
      }),
      'adjust_asset_meter',
    );
    expect(cap.after).toBe(4);
  });

  it('blocks integrity recovery while battered', () => {
    const { state, instanceId } = addAsset(STARSHIP);
    const damaged = stateOf(
      run(state, {
        type: 'adjust_asset_meter',
        assetId: instanceId,
        control: 'integrity',
        delta: -2,
      }),
      'adjust_asset_meter',
    );
    const battered = stateOf(
      run(damaged, { type: 'mark_impact', impactId: 'battered', assetId: instanceId }),
      'mark_impact',
    );
    expect(
      failureCode(
        run(battered, {
          type: 'adjust_asset_meter',
          assetId: instanceId,
          control: 'integrity',
          delta: 1,
        }),
      ),
    ).toBe('integrity_recovery_blocked');
    const repaired = stateOf(
      run(battered, { type: 'clear_impact', impactId: 'battered' }),
      'clear_impact',
    );
    expect(
      run(repaired, {
        type: 'adjust_asset_meter',
        assetId: instanceId,
        control: 'integrity',
        delta: 1,
      }).ok,
    ).toBe(true);
  });

  it('routes impact controls to mark_impact and refuses them here', () => {
    const { state, instanceId } = addAsset(BANSHEE);
    expect(
      failureCode(
        run(state, {
          type: 'set_asset_control',
          assetId: instanceId,
          control: 'health',
          value: true,
        }),
      ),
    ).toBe('invalid_control_value');
    const { state: shipState, instanceId: ship } = addAsset(STARSHIP);
    expect(
      failureCode(
        run(shipState, {
          type: 'set_asset_control',
          assetId: ship,
          control: 'battered',
          value: true,
        }),
      ),
    ).toBe('control_is_impact');
    expect(
      failureCode(
        run(shipState, {
          type: 'set_asset_control',
          assetId: ship,
          control: 'missing',
          value: true,
        }),
      ),
    ).toBe('asset_control_missing');
  });

  it('tracks disabling controls (out_of_action)', () => {
    const { state, instanceId } = addAsset(BANSHEE);
    const off = run(state, {
      type: 'set_asset_control',
      assetId: instanceId,
      control: 'out_of_action',
      value: true,
    });
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(assetDisabled(off.state.assets[0]!, realIndex)).toBe(true);
    expect(assetDisabled(state.assets[0]!, realIndex)).toBe(false);
  });

  it('discards an asset together with its impacts', () => {
    const { state, instanceId } = addAsset(STARSHIP);
    const marked = stateOf(
      run(state, { type: 'mark_impact', impactId: 'battered', assetId: instanceId }),
      'mark_impact',
    );
    const discardedResult = run(marked, { type: 'discard_asset', assetId: instanceId });
    const discarded = outcomeOf(discardedResult, 'discard_asset');
    expect(discarded.clearedImpacts).toEqual(['battered']);
    expect(discardedResult.state.assets).toHaveLength(0);
    expect(discardedResult.state.characters[0]!.impacts).toEqual([]);
  });
});

describe('asset_control rolls (M5)', () => {
  it('rolls +companion health and stores the selection for burns', () => {
    const { state, instanceId } = addAsset(BANSHEE);
    const wounded = stateOf(
      run(state, { type: 'adjust_asset_meter', assetId: instanceId, control: 'health', delta: -1 }),
      'adjust_asset_meter',
    );
    const rolled = run(wounded, {
      type: 'action_roll',
      assetMeter: { assetId: instanceId, control: 'health' },
    });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    const outcome = rolled.outcome as ActionRollOutcome;
    expect(outcome.baseValue).toBe(3);
    expect(outcome.assetMeter).toEqual({ assetId: instanceId, control: 'health' });
    const charged = stateOf(
      run(rolled.state, { type: 'adjust_momentum', delta: 6 }),
      'adjust_momentum',
    );
    const burned = outcomeOf(
      run(charged, { type: 'burn_momentum', rollId: outcome.rollId }),
      'burn_momentum',
    );
    expect(burned.result.baseValue).toBe(3);
  });

  it('rejects mixed selections, unknown assets, wrong meters and disabled assets', () => {
    const { state, instanceId } = addAsset(BANSHEE);
    expect(
      failureCode(
        run(state, {
          type: 'action_roll',
          stat: 'wits',
          assetMeter: { assetId: instanceId, control: 'health' },
        }),
      ),
    ).toBe('both_roll_selections');
    expect(
      failureCode(
        run(state, { type: 'action_roll', assetMeter: { assetId: 'asset-99', control: 'health' } }),
      ),
    ).toBe('unknown_asset');
    expect(
      failureCode(
        run(state, {
          type: 'action_roll',
          assetMeter: { assetId: instanceId, control: 'integrity' },
        }),
      ),
    ).toBe('asset_control_missing');
    const off = stateOf(
      run(state, {
        type: 'set_asset_control',
        assetId: instanceId,
        control: 'out_of_action',
        value: true,
      }),
      'set_asset_control',
    );
    expect(
      failureCode(
        run(off, { type: 'action_roll', assetMeter: { assetId: instanceId, control: 'health' } }),
      ),
    ).toBe('asset_disabled');
  });
});

describe('count_as_impact and enhancements (M5)', () => {
  it('counts count_as_impact assets into momentum max/reset', () => {
    const state = campaign();
    expect(momentumMax(state, realIndex)).toBe(10);
    const withOathbreaker = stateOf(
      run(state, { type: 'add_asset', assetId: OATHBREAKER }),
      'add_asset',
    );
    expect(realIndex.getAsset(OATHBREAKER)!.count_as_impact).toBe(true);
    expect(momentumMax(withOathbreaker, realIndex)).toBe(9);
    expect(momentumReset(withOathbreaker, realIndex)).toBe(1);
  });

  it('lists enhancements from enabled abilities including wildcards', () => {
    let state = campaign();
    state = stateOf(run(state, { type: 'add_asset', assetId: STARSHIP }), 'add_asset');
    state = stateOf(run(state, { type: 'add_asset', assetId: BANSHEE }), 'add_asset');
    const starship = state.assets.find((a) => a.assetId === STARSHIP)!;
    starship.enabledAbilities.push(2);
    const forWithstand = listEnhancements(
      state,
      realIndex,
      'starforged/moves/suffer/withstand_damage',
    );
    expect(forWithstand.map((e) => e.assetId)).toEqual([STARSHIP]);
    expect(forWithstand[0]!.instanceId).toBe(starship.id);
    const forExpedition = listEnhancements(
      state,
      realIndex,
      'starforged/moves/exploration/undertake_an_expedition',
    );
    expect(forExpedition.map((e) => e.assetId)).toEqual([BANSHEE]);
    expect(listEnhancements(state, realIndex, 'starforged/moves/combat/gain_ground')).toEqual([]);
  });

  it('skips enhancements of disabled assets and locked abilities', () => {
    const { state, instanceId } = addAsset(BANSHEE);
    const off = stateOf(
      run(state, {
        type: 'set_asset_control',
        assetId: instanceId,
        control: 'out_of_action',
        value: true,
      }),
      'set_asset_control',
    );
    expect(
      listEnhancements(off, realIndex, 'starforged/moves/exploration/undertake_an_expedition'),
    ).toEqual([]);
  });
});

describe('legacy rewards and track lifecycle (M5)', () => {
  it('computes legacy reward ticks per rank with optional downgrade', () => {
    expect(legacyRewardTicks('troublesome')).toBe(1);
    expect(legacyRewardTicks('dangerous')).toBe(2);
    expect(legacyRewardTicks('formidable')).toBe(4);
    expect(legacyRewardTicks('extreme')).toBe(8);
    expect(legacyRewardTicks('epic')).toBe(12);
    expect(legacyRewardTicks('formidable', 1)).toBe(2);
    expect(legacyRewardTicks('troublesome', 1)).toBe(0);
    expect(legacyRewardTicks('epic', 2)).toBe(4);
  });

  it('removes and updates tracks (recommit flows)', () => {
    let state = campaign();
    state = stateOf(
      run(state, {
        type: 'add_track',
        title: 'Recover the Beacon',
        rank: 'dangerous',
        kind: 'vow',
      }),
      'add_track',
    );
    const trackId = Object.keys(state.tracks)[0]!;
    state = stateOf(run(state, { type: 'mark_progress', trackId, marks: 2 }), 'mark_progress');
    state = stateOf(
      run(state, { type: 'update_track', trackId, ticks: 8, rank: 'formidable' }),
      'update_track',
    );
    expect(state.tracks[trackId]).toMatchObject({ ticks: 8, rank: 'formidable' });
    state = stateOf(run(state, { type: 'remove_track', trackId }), 'remove_track');
    expect(state.tracks[trackId]).toBeUndefined();
    expect(failureCode(run(state, { type: 'remove_track', trackId }))).toBe('unknown_track');
    expect(failureCode(run(state, { type: 'update_track', trackId }))).toBe('unknown_track');
  });

  it('applies negative legacy ticks without touching experience', () => {
    let state = campaign();
    state = stateOf(
      run(state, { type: 'adjust_legacy', legacy: 'bonds_legacy', ticks: 9 }),
      'adjust_legacy',
    );
    expect(state.experience).toBe(4);
    const decreased = run(state, { type: 'adjust_legacy', legacy: 'bonds_legacy', ticks: -4 });
    expect(decreased.ok).toBe(true);
    if (!decreased.ok) return;
    expect(decreased.outcome).toMatchObject({ ticksAdded: -4, ticks: 5, experienceGained: 0 });
    expect(decreased.state.experience).toBe(4);
    const floored = run(decreased.state, {
      type: 'adjust_legacy',
      legacy: 'bonds_legacy',
      ticks: -40,
    });
    expect(floored.ok).toBe(true);
    if (!floored.ok) return;
    expect(floored.state.legacy.bonds_legacy.ticks).toBe(0);
    expect(
      failureCode(run(state, { type: 'adjust_legacy', legacy: 'bonds_legacy', ticks: 0 })),
    ).toBe('invalid_ticks');
  });

  it('grants 1 xp per box on a cleared track (Rules-Summary p4)', () => {
    let state = campaign();
    state = stateOf(
      run(state, { type: 'adjust_legacy', legacy: 'discoveries_legacy', ticks: 40 }),
      'adjust_legacy',
    );
    expect(state.legacy.discoveries_legacy).toEqual({ ticks: 0, cleared: true });
    expect(state.experience).toBe(20);
    state = stateOf(
      run(state, { type: 'adjust_legacy', legacy: 'discoveries_legacy', ticks: 16 }),
      'adjust_legacy',
    );
    expect(state.experience).toBe(24);
    expect(progressScore(state.legacy.discoveries_legacy.ticks, true)).toBe(10);
  });
});

describe('migration (M5+, state v4)', () => {
  it('upgrades a v1 save through the chain (v1→v2→v3→v4) and is idempotent', () => {
    const { state } = addAsset(STARSHIP);
    const v1 = {
      ...state,
      version: 1,
      experience: undefined,
      contentFlags: undefined,
      characters: state.characters.map(({ background: _background, ...rest }) => rest),
      assets: state.assets.map(({ controls: _controls, ...rest }) => rest),
    } as unknown as ReturnType<typeof campaign>;
    const migrated = migrateCampaignState(v1);
    expect(migrated.version).toBe(4);
    expect(migrated.experience).toBe(0);
    expect(migrated.contentFlags).toEqual([]);
    expect(migrated.characters[0]!.background).toBe('');
    expect(migrated.assets[0]!.controls).toEqual({});
    expect(migrateCampaignState(migrated)).toBe(migrated);
    let code = 'no-error';
    try {
      migrateCampaignState({ ...migrated, version: 99 });
    } catch (e) {
      code = (e as { code?: string }).code ?? 'thrown';
    }
    expect(code).toBe('version_mismatch');
  });

  it('upgrades a v2 save to v3 (contentFlags default)', () => {
    const { state } = addAsset(STARSHIP);
    const v2 = { ...state, version: 2, contentFlags: undefined } as unknown as ReturnType<
      typeof campaign
    >;
    const migrated = migrateCampaignState(v2);
    expect(migrated.version).toBe(4);
    expect(migrated.contentFlags).toEqual([]);
    expect(migrated.experience).toBe(state.experience);
  });

  it('upgrades a v3 save to v4 (character.background default)', () => {
    const { state } = addAsset(STARSHIP);
    const v3 = { ...state, version: 3 } as unknown as ReturnType<typeof campaign>;
    const migrated = migrateCampaignState(v3);
    expect(migrated.version).toBe(4);
    expect(migrated.characters[0]!.background).toBe('');
  });
});

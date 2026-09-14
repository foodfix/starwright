import { describe, expect, it } from 'vitest';
import type { StatId, StarforgedIndex } from '@starwright/data';
import { mulberry32 } from './dice/rng.js';
import { createNewCampaign, momentumMax, momentumReset } from './state/create.js';
import { reduce, type EngineContext } from './reducer.js';
import type { ActionRollOutcome, BurnMomentumOutcome, ProgressRollOutcome } from './audit.js';
import { realIndex, outcomeOf } from './test-support.js';

const STATS: Record<StatId, number> = { edge: 2, heart: 3, iron: 1, shadow: 1, wits: 2 };

const ctx: EngineContext = { index: realIndex, rng: mulberry32(42) };

function freshContext(seed = 42): EngineContext {
  return { index: realIndex, rng: mulberry32(seed) };
}

function failureCode(run: () => unknown): string {
  const result = run() as { ok: boolean; error?: { code?: string } };
  expect(result.ok).toBe(false);
  return result.error?.code ?? '';
}

describe('createNewCampaign background', () => {
  it('stores the trimmed background and defaults to empty', () => {
    const withBackground = createNewCampaign({
      characterName: 'Raven',
      stats: STATS,
      background: '  Raised on a Terminus quarry. Stole a ship and ran.  ',
    });
    expect(withBackground.characters[0]!.background).toBe(
      'Raised on a Terminus quarry. Stole a ship and ran.',
    );
    const without = createNewCampaign({ characterName: 'Raven', stats: STATS });
    expect(without.characters[0]!.background).toBe('');
  });

  it('rejects a non-string background', () => {
    expect(() =>
      createNewCampaign({
        characterName: 'Raven',
        stats: STATS,
        background: 42 as unknown as string,
      }),
    ).toThrowError(/background must be a string/);
  });
});

describe('action_roll', () => {
  it('rolls three dice and records the settlement', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const result = reduce(state, { type: 'action_roll', stat: 'wits' }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const outcome = result.outcome as ActionRollOutcome;
    expect(outcome.kind).toBe('action_roll');
    expect(outcome.dice.actionDie).toBeGreaterThanOrEqual(1);
    expect(outcome.dice.actionDie).toBeLessThanOrEqual(10);
    expect(outcome.dice.challenge).toHaveLength(2);
    expect(outcome.baseValue).toBe(2);
    expect(outcome.rollId).toBe('roll-0');
    expect(result.state.journal).toHaveLength(1);
    expect(result.state.journal[0]?.outcome).toEqual(outcome);
    expect(result.state.seq).toBeGreaterThan(0);
  });

  it('supports condition meter rolls and adds', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const result = reduce(state, { type: 'action_roll', meter: 'supply', add: 1 }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const outcome = result.outcome as ActionRollOutcome;
    expect(outcome.meter).toBe('supply');
    expect(outcome.baseValue).toBe(5);
    expect(outcome.add).toBe(1);
  });

  it('allows at most one roll selection (M4: none is a +add-only roll)', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    expect(
      failureCode(() => reduce(state, { type: 'action_roll', stat: 'wits', meter: 'supply' }, ctx)),
    ).toBe('both_roll_selections');
  });

  it('rolls with base 0 when neither stat nor meter is chosen (M4 +rank rolls)', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const result = reduce(state, { type: 'action_roll', add: 3 }, freshContext(7));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const outcome = result.outcome as ActionRollOutcome;
    expect(outcome.baseValue).toBe(0);
    expect(outcome.stat).toBeUndefined();
    expect(outcome.meter).toBeUndefined();
    expect(outcome.add).toBe(3);
    expect(outcome.rawScore).toBe(outcome.dice.actionDie + 3);
  });

  it('rejects invalid adds', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    expect(
      failureCode(() => reduce(state, { type: 'action_roll', stat: 'wits', add: 1.5 }, ctx)),
    ).toBe('invalid_add');
    expect(
      failureCode(() => reduce(state, { type: 'action_roll', stat: 'wits', add: 11 }, ctx)),
    ).toBe('invalid_add');
  });

  it('does not mutate the input state', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const snapshot = structuredClone(state);
    reduce(state, { type: 'action_roll', stat: 'wits' }, ctx);
    expect(state).toEqual(snapshot);
  });
});

describe('burn_momentum', () => {
  function setupMissWithMomentum(): {
    state: ReturnType<typeof createNewCampaign>;
    rollId: string;
    ctx: EngineContext;
  } {
    // Find a seed whose first action roll (stat heart=3) misses both challenge dice.
    for (let seed = 1; seed < 500; seed++) {
      const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
      const trialCtx = freshContext(seed);
      const boosted = reduce(state, { type: 'adjust_momentum', delta: 6 }, trialCtx);
      if (!boosted.ok) continue;
      const rolled = reduce(boosted.state, { type: 'action_roll', stat: 'heart' }, trialCtx);
      if (!rolled.ok) continue;
      const outcome = rolled.outcome as ActionRollOutcome;
      if (outcome.outcome === 'miss') {
        return { state: rolled.state, rollId: outcome.rollId, ctx: trialCtx };
      }
    }
    throw new Error('no seed produced a miss');
  }

  it('replaces the score with positive momentum and resets momentum', () => {
    const { state, rollId, ctx: runCtx } = setupMissWithMomentum();
    expect(state.momentum).toBe(8);
    const burned = reduce(state, { type: 'burn_momentum', rollId }, runCtx);
    expect(burned.ok).toBe(true);
    if (!burned.ok) return;
    const outcome = burned.outcome as BurnMomentumOutcome;
    expect(outcome.kind).toBe('burn_momentum');
    expect(outcome.result.burned).toBe(true);
    expect(outcome.result.score).toBe(8);
    expect(outcome.momentumBefore).toBe(8);
    expect(outcome.momentumAfter).toBe(2);
    expect(outcome.reset).toBe(2);
    expect(['strong_hit', 'weak_hit']).toContain(outcome.result.outcome);
  });

  it('rejects a second burn of the same roll', () => {
    const { state, rollId, ctx: runCtx } = setupMissWithMomentum();
    const first = reduce(state, { type: 'burn_momentum', rollId }, runCtx);
    expect(first.ok).toBe(true);
    expect(
      failureCode(() =>
        reduce(first.ok ? first.state : state, { type: 'burn_momentum', rollId }, runCtx),
      ),
    ).toBe('already_burned');
  });

  it('rejects unknown rolls and non-positive momentum', () => {
    const { state, ctx: runCtx } = setupMissWithMomentum();
    expect(
      failureCode(() => reduce(state, { type: 'burn_momentum', rollId: 'roll-999' }, runCtx)),
    ).toBe('unknown_roll');
    const drained = reduce(state, { type: 'adjust_momentum', delta: -10 }, runCtx);
    expect(drained.ok).toBe(true);
    if (!drained.ok) return;
    expect(drained.state.momentum).toBeLessThanOrEqual(0);
    const missOutcome = drained.state.journal
      .map((e) => e.outcome)
      .find((o) => o?.kind === 'action_roll');
    if (missOutcome?.kind === 'action_roll') {
      expect(
        failureCode(() =>
          reduce(drained.state, { type: 'burn_momentum', rollId: missOutcome.rollId }, runCtx),
        ),
      ).toBe('burn_requires_positive_momentum');
    }
  });

  it('cannot burn a progress roll', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const track = reduce(state, { type: 'add_track', title: 'T', rank: 'formidable' }, ctx);
    expect(track.ok).toBe(true);
    if (!track.ok) return;
    const rolled = reduce(
      track.state,
      { type: 'progress_roll', trackId: outcomeOf(track, 'add_track').trackId },
      ctx,
    );
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    const outcome = rolled.outcome as ProgressRollOutcome;
    expect(
      failureCode(() =>
        reduce(rolled.state, { type: 'burn_momentum', rollId: outcome.rollId }, ctx),
      ),
    ).toBe('unknown_roll');
  });
});

describe('adjust_momentum', () => {
  it('clamps to [-6, momentumMax]', () => {
    let state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const up = reduce(state, { type: 'adjust_momentum', delta: 20 }, ctx);
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    expect(up.state.momentum).toBe(momentumMax(up.state));
    state = up.state;
    const down = reduce(state, { type: 'adjust_momentum', delta: -99 }, ctx);
    expect(down.ok).toBe(true);
    if (!down.ok) return;
    expect(down.state.momentum).toBe(-6);
  });

  it('rejects zero and non-integer deltas', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    expect(failureCode(() => reduce(state, { type: 'adjust_momentum', delta: 0 }, ctx))).toBe(
      'invalid_delta',
    );
    expect(failureCode(() => reduce(state, { type: 'adjust_momentum', delta: 1.5 }, ctx))).toBe(
      'invalid_delta',
    );
  });

  it('respects reduced max from impacts', () => {
    let state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const marked = reduce(state, { type: 'mark_impact', impactId: 'wounded' }, ctx);
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    state = marked.state;
    const up = reduce(state, { type: 'adjust_momentum', delta: 20 }, ctx);
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    expect(up.state.momentum).toBe(9);
    expect(momentumMax(up.state)).toBe(9);
  });
});

describe('meters and impacts', () => {
  it('adjusts meters within [0, 5]', () => {
    let state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const down = reduce(state, { type: 'adjust_meter', meter: 'health', delta: -2 }, ctx);
    expect(down.ok).toBe(true);
    if (!down.ok) return;
    expect(down.state.characters[0]?.meters.health).toBe(3);
    state = down.state;
    const floor = reduce(state, { type: 'adjust_meter', meter: 'health', delta: -9 }, ctx);
    expect(floor.ok).toBe(true);
    if (!floor.ok) return;
    expect(floor.state.characters[0]?.meters.health).toBe(0);
  });

  it('blocks meter recovery while the impact is marked', () => {
    let state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const drained = reduce(state, { type: 'adjust_meter', meter: 'health', delta: -5 }, ctx);
    expect(drained.ok).toBe(true);
    if (!drained.ok) return;
    state = drained.state;
    const marked = reduce(state, { type: 'mark_impact', impactId: 'wounded' }, ctx);
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    state = marked.state;
    const blocked = reduce(state, { type: 'adjust_meter', meter: 'health', delta: 1 }, ctx);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.code).toBe('meter_recovery_blocked');
    expect(blocked.state).toEqual(state);
    const spiritOk = reduce(state, { type: 'adjust_meter', meter: 'spirit', delta: 1 }, ctx);
    expect(spiritOk.ok).toBe(true);
    const cleared = reduce(
      spiritOk.ok ? spiritOk.state : state,
      { type: 'clear_impact', impactId: 'wounded' },
      ctx,
    );
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const healed = reduce(cleared.state, { type: 'adjust_meter', meter: 'health', delta: 1 }, ctx);
    expect(healed.ok).toBe(true);
    if (!healed.ok) return;
    expect(healed.state.characters[0]?.meters.health).toBe(1);
  });

  it('enforces impact marking rules', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    expect(failureCode(() => reduce(state, { type: 'mark_impact', impactId: 'nope' }, ctx))).toBe(
      'unknown_impact',
    );
    expect(
      failureCode(() => reduce(state, { type: 'mark_impact', impactId: 'battered' }, ctx)),
    ).toBe('vehicle_impact_requires_asset');
    const marked = reduce(state, { type: 'mark_impact', impactId: 'doomed' }, ctx);
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    expect(
      failureCode(() => reduce(marked.state, { type: 'mark_impact', impactId: 'doomed' }, ctx)),
    ).toBe('impact_already_marked');
    expect(marked.state.characters[0]?.impacts).toEqual([
      { impactId: 'doomed', category: 'burdens', permanent: false },
    ]);
  });

  it('refuses to clear permanent impacts including cursed', () => {
    let state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const mark = (impactId: string, assetId?: string): void => {
      const marked = reduce(state, { type: 'mark_impact', impactId, assetId }, ctx);
      expect(marked.ok).toBe(true);
      if (!marked.ok) return;
      state = marked.state;
    };
    mark('permanently_harmed');
    mark('cursed', 'starforged/assets/command_vehicle/starship');
    mark('shaken');
    expect(
      failureCode(() =>
        reduce(state, { type: 'clear_impact', impactId: 'permanently_harmed' }, ctx),
      ),
    ).toBe('impact_permanent');
    expect(
      failureCode(() => reduce(state, { type: 'clear_impact', impactId: 'cursed' }, ctx)),
    ).toBe('impact_permanent');
    expect(
      failureCode(() => reduce(state, { type: 'clear_impact', impactId: 'doomed' }, ctx)),
    ).toBe('impact_not_marked');
    const cleared = reduce(state, { type: 'clear_impact', impactId: 'shaken' }, ctx);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.state.characters[0]?.impacts.map((i) => i.impactId)).toEqual([
      'permanently_harmed',
      'cursed',
    ]);
    // the cleared list on the clear_impact outcome reflects post-clear impacts
    expect((cleared.outcome as { impacts: string[] }).impacts).toEqual([
      'permanently_harmed',
      'cursed',
    ]);
  });

  it('vehicle impacts affect momentum only while aboard', () => {
    let state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const marked = reduce(
      state,
      {
        type: 'mark_impact',
        impactId: 'battered',
        assetId: 'starforged/assets/command_vehicle/starship',
      },
      ctx,
    );
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    state = marked.state;
    expect(momentumReset(state)).toBe(2);
    const aboard = reduce(
      state,
      { type: 'set_aboard_vehicle', assetIds: ['starforged/assets/command_vehicle/starship'] },
      ctx,
    );
    expect(aboard.ok).toBe(true);
    if (!aboard.ok) return;
    expect(momentumReset(aboard.state)).toBe(1);
    expect(momentumMax(aboard.state)).toBe(9);
  });
});

describe('tracks', () => {
  it('creates tracks and marks progress per rank', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const created = reduce(
      state,
      { type: 'add_track', title: 'Recover the Beacon', rank: 'dangerous', kind: 'vow' },
      ctx,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const trackId = outcomeOf(created, 'add_track').trackId;
    expect(created.state.tracks[trackId]).toEqual({
      title: 'Recover the Beacon',
      rank: 'dangerous',
      kind: 'vow',
      ticks: 0,
    });
    const marked = reduce(created.state, { type: 'mark_progress', trackId, marks: 1 }, ctx);
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    expect(marked.state.tracks[trackId]?.ticks).toBe(8);
    const twice = reduce(marked.state, { type: 'mark_progress', trackId, marks: 2 }, ctx);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect(twice.state.tracks[trackId]?.ticks).toBe(24);
  });

  it('maps ranks to tick amounts', () => {
    const expectations: Record<string, number> = {
      troublesome: 12,
      dangerous: 8,
      formidable: 4,
      extreme: 2,
      epic: 1,
    };
    for (const [rank, ticks] of Object.entries(expectations)) {
      const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
      const created = reduce(
        state,
        { type: 'add_track', title: 'T', rank: rank as 'dangerous' },
        ctx,
      );
      if (!created.ok) throw new Error('add_track failed');
      const marked = reduce(
        created.state,
        { type: 'mark_progress', trackId: outcomeOf(created, 'add_track').trackId },
        ctx,
      );
      expect(marked.ok).toBe(true);
      if (!marked.ok) continue;
      expect(marked.state.tracks[outcomeOf(created, 'add_track').trackId]?.ticks).toBe(ticks);
    }
  });

  it('caps ticks at 40 and supports explicit ticks', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const created = reduce(state, { type: 'add_track', title: 'T', rank: 'troublesome' }, ctx);
    if (!created.ok) throw new Error('add_track failed');
    const trackId = outcomeOf(created, 'add_track').trackId;
    const marked = reduce(created.state, { type: 'mark_progress', trackId, marks: 4 }, ctx);
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    expect(marked.state.tracks[trackId]?.ticks).toBe(40);
    const saturated = reduce(marked.state, { type: 'mark_progress', trackId, marks: 1 }, ctx);
    expect(saturated.ok).toBe(true);
    if (!saturated.ok) return;
    expect(saturated.state.tracks[trackId]?.ticks).toBe(40);
    const ambiguous = reduce(
      saturated.state,
      { type: 'mark_progress', trackId, marks: 1, ticks: 2 },
      ctx,
    );
    expect(ambiguous.ok).toBe(false);
    if (ambiguous.ok) return;
    expect(ambiguous.error.code).toBe('ambiguous_mark');
    expect(ambiguous.state).toEqual(saturated.state);
  });

  it('requires explicit ticks for unranked tracks', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const created = reduce(state, { type: 'add_track', title: 'T', rank: null }, ctx);
    if (!created.ok) throw new Error('add_track failed');
    const trackId = outcomeOf(created, 'add_track').trackId;
    expect(failureCode(() => reduce(created.state, { type: 'mark_progress', trackId }, ctx))).toBe(
      'rank_required',
    );
    const marked = reduce(created.state, { type: 'mark_progress', trackId, ticks: 3 }, ctx);
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    expect(marked.state.tracks[trackId]?.ticks).toBe(3);
  });

  it('validates mark inputs and unknown tracks', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    expect(
      failureCode(() => reduce(state, { type: 'mark_progress', trackId: 'track-9' }, ctx)),
    ).toBe('unknown_track');
    expect(
      failureCode(() => reduce(state, { type: 'progress_roll', trackId: 'track-9' }, ctx)),
    ).toBe('unknown_track');
    expect(
      failureCode(() =>
        reduce(state, { type: 'mark_progress', trackId: 'track-9', marks: 1, ticks: 2 }, ctx),
      ),
    ).toBe('unknown_track');
  });

  it('rolls progress against filled boxes', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const created = reduce(
      state,
      { type: 'add_track', title: 'Skirmish', rank: 'formidable', kind: 'fray' },
      ctx,
    );
    if (!created.ok) throw new Error('add_track failed');
    const trackId = outcomeOf(created, 'add_track').trackId;
    const marked = reduce(created.state, { type: 'mark_progress', trackId, marks: 2 }, ctx);
    if (!marked.ok) throw new Error('mark_progress failed');
    const rolled = reduce(marked.state, { type: 'progress_roll', trackId }, ctx);
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    const outcome = rolled.outcome as ProgressRollOutcome;
    expect(outcome.score).toBe(2);
    expect(outcome.ticks).toBe(8);
    expect(outcome.dice.challenge).toHaveLength(2);
  });

  it('rolls against legacy tracks at 10 once filled (M5: xp and clear-at-ten)', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const adjusted = reduce(
      state,
      { type: 'adjust_legacy', legacy: 'quests_legacy', ticks: 39 },
      ctx,
    );
    expect(adjusted.ok).toBe(true);
    if (!adjusted.ok) return;
    expect(adjusted.state.legacy.quests_legacy.cleared).toBe(false);
    expect(adjusted.outcome).toMatchObject({ experienceGained: 18, experience: 18 });
    const filled = reduce(
      adjusted.state,
      { type: 'adjust_legacy', legacy: 'quests_legacy', ticks: 4 },
      ctx,
    );
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    // the tenth box fills (grants 2 XP) and immediately clears the track
    expect(filled.state.legacy.quests_legacy.ticks).toBe(0);
    expect(filled.state.legacy.quests_legacy.cleared).toBe(true);
    expect(filled.outcome).toMatchObject({ ticksAdded: 1, experienceGained: 2, experience: 20 });
    // a cleared track resumes marking at the reduced rate (1 XP per box)
    const resumed = reduce(
      filled.state,
      { type: 'adjust_legacy', legacy: 'quests_legacy', ticks: 4 },
      ctx,
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.state.legacy.quests_legacy.ticks).toBe(4);
    expect(resumed.outcome).toMatchObject({ experienceGained: 1, experience: 21 });
    const rolled = reduce(filled.state, { type: 'progress_roll', trackId: 'quests_legacy' }, ctx);
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect((rolled.outcome as ProgressRollOutcome).score).toBe(10);
    expect(
      failureCode(() =>
        reduce(
          filled.state,
          { type: 'adjust_legacy', legacy: 'bonds' as 'quests_legacy', ticks: 1 },
          ctx,
        ),
      ),
    ).toBe('unknown_legacy');
  });
});

describe('scene and journal', () => {
  it('handles flags, notes, boarding, and scene changes', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const flagged = reduce(state, { type: 'set_flag', key: 'alarm', value: true }, ctx);
    expect(flagged.ok).toBe(true);
    if (!flagged.ok) return;
    expect(flagged.state.scene.flags['alarm']).toBe(true);
    const noted = reduce(
      flagged.state,
      { type: 'add_journal_entry', text: 'The vault hums.' },
      ctx,
    );
    expect(noted.ok).toBe(true);
    if (!noted.ok) return;
    const note = noted.state.journal.at(-1);
    expect(note?.kind).toBe('note');
    expect(note?.note).toBe('The vault hums.');
    const ended = reduce(noted.state, { type: 'end_scene' }, ctx);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.state.scene.index).toBe(2);
    expect(ended.state.journal.at(-2)?.sceneIndex).toBe(1);
    expect(ended.state.journal.at(-1)?.sceneIndex).toBe(2);
    expect(ended.state.journal.at(-1)?.kind).toBe('settlement');
    expect(
      failureCode(() => reduce(ended.state, { type: 'add_journal_entry', text: '  ' }, ctx)),
    ).toBe('empty_text');
  });

  it('rejects a state with an unsupported version', () => {
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const mutated = { ...state, version: 99 };
    expect(failureCode(() => reduce(mutated, { type: 'end_scene' }, ctx))).toBe('version_mismatch');
  });
});

describe('stub index', () => {
  it('works with an empty impacts table', () => {
    const stub = { data: { rules: { impacts: {} } } } as unknown as StarforgedIndex;
    const state = createNewCampaign({ characterName: 'Raven', stats: STATS });
    const result = reduce(
      state,
      { type: 'adjust_meter', meter: 'spirit', delta: 1 },
      { index: stub, rng: mulberry32(7) },
    );
    expect(result.ok).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { StatId, StarforgedIndex } from '@starwright/data';
import { mulberry32, type Rng } from './dice/rng.js';
import { compareOutcome, computeActionRoll, rollChallengePair, rollDie } from './dice/rolls.js';
import { createNewCampaign, momentumMax } from './state/create.js';
import { reduce, type EngineContext } from './reducer.js';
import { outcomeOf } from './test-support.js';
import type { ActionRollOutcome } from './audit.js';

const N = 10_000;
const SEED = 20260914;
const STATS: Record<StatId, number> = { edge: 2, heart: 3, iron: 1, shadow: 1, wits: 2 };

const stubIndex = { data: { rules: { impacts: {} } } } as unknown as StarforgedIndex;

function drawInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

describe('action roll outcome distribution (10k, stat 0, no add)', () => {
  it('matches the theoretical strong/weak/miss split within tolerance', () => {
    const rng = mulberry32(SEED);
    const counts = { strong_hit: 0, weak_hit: 0, miss: 0 };
    for (let i = 0; i < N; i++) {
      const dice = { actionDie: rollDie(rng, 10), challenge: rollChallengePair(rng) };
      const outcome = compareOutcome(dice.actionDie, dice.challenge);
      counts[outcome] += 1;
    }
    const expected = { strong_hit: 0.285, weak_hit: 0.33, miss: 0.385 };
    for (const key of ['strong_hit', 'weak_hit', 'miss'] as const) {
      const observed = counts[key] / N;
      expect(Math.abs(observed - expected[key])).toBeLessThan(0.02);
    }
  });
});

describe('action roll invariants (10k random setups)', () => {
  it('recomputes score, cancellation, match, and outcome independently', () => {
    const rng = mulberry32(SEED + 1);
    for (let i = 0; i < N; i++) {
      const state = createNewCampaign({ characterName: 'R', stats: STATS });
      const stat = (['edge', 'heart', 'iron', 'shadow', 'wits'] as const)[drawInt(rng, 0, 4)]!;
      state.characters[0]!.stats[stat] = drawInt(rng, 0, 3);
      state.momentum = drawInt(rng, -6, 10);
      const add = drawInt(rng, -2, 2);
      const ctx: EngineContext = { index: stubIndex, rng };
      const result = reduce(state, { type: 'action_roll', stat, add }, ctx);
      if (!result.ok) throw new Error(`unexpected failure: ${result.error.message}`);
      const o = result.outcome as ActionRollOutcome;
      const [c1, c2] = o.dice.challenge;

      // independent recomputation
      const canceled = state.momentum < 0 && Math.abs(state.momentum) === o.dice.actionDie;
      const raw = canceled
        ? state.characters[0]!.stats[stat] + add
        : o.dice.actionDie + state.characters[0]!.stats[stat] + add;
      const score = Math.min(10, Math.max(0, raw));
      expect(o.score).toBe(score);
      expect(o.canceledActionDie).toBe(canceled);
      expect(o.match).toBe(c1 === c2);
      expect(o.outcome).toBe(compareOutcome(score, [c1, c2]));
      expect(o.burned).toBe(false);
      expect(o.rawScore).toBe(raw);
    }
  });

  it('recomputes burn re-evaluation independently (10k random setups)', () => {
    const rng = mulberry32(SEED + 4);
    for (let i = 0; i < N; i++) {
      const dice = { actionDie: rollDie(rng, 10), challenge: rollChallengePair(rng) };
      const stat = (['edge', 'heart', 'iron', 'shadow', 'wits'] as const)[drawInt(rng, 0, 4)]!;
      const base = drawInt(rng, 0, 3);
      const add = drawInt(rng, -2, 2);
      const momentum = drawInt(rng, 1, 10);
      const o = computeActionRoll({ stat, add, momentumBurn: true }, dice, {
        baseValue: base,
        momentum,
      });
      const score = Math.min(10, momentum);
      expect(o.burned).toBe(true);
      expect(o.score).toBe(score);
      expect(o.outcome).toBe(compareOutcome(score, dice.challenge));
      expect(o.rawScore).toBe(dice.actionDie + base + add);
    }
  });
});

describe('progress roll invariants (10k random tracks)', () => {
  it('scores filled boxes and compares to the challenge dice', () => {
    const rng = mulberry32(SEED + 2);
    for (let i = 0; i < N; i++) {
      const state = createNewCampaign({ characterName: 'R', stats: STATS });
      const rank = (['troublesome', 'dangerous', 'formidable', 'extreme', 'epic'] as const)[
        drawInt(rng, 0, 4)
      ]!;
      const created = reduce(state, { type: 'add_track', title: `t${i}`, rank }, ctxWith(rng));
      if (!created.ok) throw new Error('add_track failed');
      const marks = drawInt(rng, 1, 4);
      const marked = reduce(
        created.state,
        { type: 'mark_progress', trackId: outcomeOf(created, 'add_track').trackId, marks },
        ctxWith(rng),
      );
      if (!marked.ok) throw new Error('mark_progress failed');
      const ticks = marked.state.tracks[outcomeOf(created, 'add_track').trackId]?.ticks ?? 0;
      const expectedScore = Math.floor(ticks / 4);
      const rolled = reduce(
        marked.state,
        { type: 'progress_roll', trackId: outcomeOf(created, 'add_track').trackId },
        ctxWith(rng),
      );
      if (!rolled.ok) throw new Error('progress_roll failed');
      const o = rolled.outcome;
      expect(o.kind).toBe('progress_roll');
      if (o.kind !== 'progress_roll') return;
      expect(o.score).toBe(expectedScore);
      expect(o.outcome).toBe(compareOutcome(expectedScore, o.dice.challenge));
      expect(o.match).toBe(o.dice.challenge[0] === o.dice.challenge[1]);
    }
  });
});

describe('momentum and meter clamp invariants (10k random events)', () => {
  it('keeps momentum within [-6, max] and meters within [0, 5]', () => {
    const rng = mulberry32(SEED + 3);
    let state = createNewCampaign({ characterName: 'R', stats: STATS });
    const meters = ['health', 'spirit', 'supply'] as const;
    for (let i = 0; i < N; i++) {
      // reset periodically so the accumulating journal keeps the walk cheap
      if (i > 0 && i % 500 === 0) {
        state = createNewCampaign({ characterName: 'R', stats: STATS });
      }
      const useMeter = rng() < 0.5;
      const delta = drawInt(rng, -7, 7) || 1;
      const event = useMeter
        ? ({ type: 'adjust_meter', meter: meters[drawInt(rng, 0, 2)]!, delta } as const)
        : ({ type: 'adjust_momentum', delta } as const);
      const result = reduce(state, event, ctxWith(rng));
      if (!result.ok) throw new Error(`unexpected failure: ${result.error.message}`);
      state = result.state;
      expect(state.momentum).toBeGreaterThanOrEqual(-6);
      expect(state.momentum).toBeLessThanOrEqual(momentumMax(state));
      for (const meter of meters) {
        const value = state.characters[0]?.meters[meter] ?? -1;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(5);
      }
    }
  });
});

function ctxWith(rng: Rng): EngineContext {
  return { index: stubIndex, rng };
}

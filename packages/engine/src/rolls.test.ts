import { describe, expect, it } from 'vitest';
import { computeActionRoll, computeProgressRoll, compareOutcome } from './dice/rolls.js';

const dice = (actionDie: number, c1: number, c2: number) => ({
  actionDie,
  challenge: [c1, c2] as [number, number],
});

describe('computeActionRoll', () => {
  it('scores strong hit when score beats both challenge dice', () => {
    const r = computeActionRoll({ stat: 'wits' }, dice(5, 4, 6), { baseValue: 2, momentum: 2 });
    expect(r.score).toBe(7);
    expect(r.outcome).toBe('strong_hit');
    expect(r.match).toBe(false);
    expect(r.burned).toBe(false);
  });

  it('scores weak hit when score beats only one challenge die', () => {
    const r = computeActionRoll({ stat: 'iron' }, dice(4, 3, 6), { baseValue: 2, momentum: 2 });
    expect(r.score).toBe(6);
    expect(r.outcome).toBe('weak_hit');
  });

  it('scores miss when score beats neither challenge die', () => {
    const r = computeActionRoll({}, dice(2, 4, 6), { baseValue: 1, momentum: 2 });
    expect(r.score).toBe(3);
    expect(r.outcome).toBe('miss');
  });

  it('resolves ties in favor of the challenge dice', () => {
    const r = computeActionRoll({}, dice(4, 4, 8), { baseValue: 0, momentum: 2 });
    expect(r.score).toBe(4);
    expect(r.outcome).toBe('miss');
  });

  it('clamps the action score at 10', () => {
    const r = computeActionRoll({ stat: 'edge', add: 5 }, dice(9, 2, 9), {
      baseValue: 5,
      momentum: 2,
    });
    expect(r.rawScore).toBe(19);
    expect(r.score).toBe(10);
    expect(r.outcome).toBe('strong_hit');
  });

  it('never beats a challenge die showing 10', () => {
    const r = computeActionRoll({ stat: 'edge' }, dice(10, 10, 10), { baseValue: 5, momentum: 2 });
    expect(r.score).toBe(10);
    expect(r.outcome).toBe('miss');
    expect(r.match).toBe(true);
  });

  it('clamps the action score at 0', () => {
    const r = computeActionRoll({ stat: 'iron', add: -5 }, dice(1, 1, 2), {
      baseValue: 1,
      momentum: 2,
    });
    expect(r.rawScore).toBe(-3);
    expect(r.score).toBe(0);
    expect(r.outcome).toBe('miss');
  });

  it('detects a match on equal challenge dice', () => {
    const r = computeActionRoll({}, dice(3, 7, 7), { baseValue: 2, momentum: 2 });
    expect(r.match).toBe(true);
    const other = computeActionRoll({}, dice(7, 3, 7), { baseValue: 2, momentum: 2 });
    expect(other.match).toBe(false);
  });

  it('cancels the action die on negative momentum matching the die', () => {
    const r = computeActionRoll({ stat: 'heart' }, dice(4, 1, 3), { baseValue: 2, momentum: -4 });
    expect(r.canceledActionDie).toBe(true);
    expect(r.rawScore).toBe(2);
    expect(r.score).toBe(2);
    expect(r.outcome).toBe('weak_hit');
  });

  it('keeps the action die when negative momentum does not match it', () => {
    const r = computeActionRoll({ stat: 'heart' }, dice(5, 1, 3), { baseValue: 2, momentum: -4 });
    expect(r.canceledActionDie).toBe(false);
    expect(r.score).toBe(7);
    expect(r.outcome).toBe('strong_hit');
  });

  it('burning momentum replaces the score with the momentum value', () => {
    const withoutBurn = computeActionRoll({ stat: 'wits' }, dice(2, 5, 8), {
      baseValue: 1,
      momentum: 7,
    });
    expect(withoutBurn.outcome).toBe('miss');
    const burned = computeActionRoll({ stat: 'wits', momentumBurn: true }, dice(2, 5, 8), {
      baseValue: 1,
      momentum: 7,
    });
    expect(burned.burned).toBe(true);
    expect(burned.score).toBe(7);
    expect(burned.outcome).toBe('weak_hit');
    expect(burned.rawScore).toBe(3);
  });

  it('ignores burn requests with non-positive momentum', () => {
    const r = computeActionRoll({ stat: 'wits', momentumBurn: true }, dice(6, 1, 2), {
      baseValue: 1,
      momentum: -3,
    });
    expect(r.burned).toBe(false);
    expect(r.score).toBe(7);
  });
});

describe('computeProgressRoll', () => {
  it('compares filled boxes against the challenge dice without momentum', () => {
    const r = computeProgressRoll(5, [4, 5]);
    expect(r.score).toBe(5);
    expect(r.outcome).toBe('weak_hit');
    expect(computeProgressRoll(5, [3, 4]).outcome).toBe('strong_hit');
    expect(computeProgressRoll(2, [3, 4]).outcome).toBe('miss');
  });

  it('flags matches on progress rolls', () => {
    expect(computeProgressRoll(3, [6, 6]).match).toBe(true);
  });
});

describe('compareOutcome', () => {
  it('matches the 7-10 boundary expectations', () => {
    expect(compareOutcome(7, [1, 6])).toBe('strong_hit');
    expect(compareOutcome(7, [7, 6])).toBe('weak_hit');
    expect(compareOutcome(7, [7, 7])).toBe('miss');
    expect(compareOutcome(10, [10, 1])).toBe('weak_hit');
  });
});

import { describe, expect, it } from 'vitest';
import type { ActionRollOutcome } from '@starwright/engine';
import { scoreBreakdown } from './scoreBreakdown.js';

function roll(partial: Partial<ActionRollOutcome>): ActionRollOutcome {
  return {
    kind: 'action_roll',
    rollId: 'roll-1',
    dice: { actionDie: 7, challenge: [10, 9] },
    baseValue: 1,
    add: 0,
    rawScore: 8,
    score: 8,
    canceledActionDie: false,
    match: false,
    outcome: 'miss',
    burned: false,
    ...partial,
  };
}

describe('scoreBreakdown (settlement card score formula)', () => {
  it('lists die and stat source for a plain stat roll', () => {
    expect(scoreBreakdown(roll({ stat: 'wits' }))).toEqual({
      terms: [
        { kind: 'die', value: 7 },
        { kind: 'stat', id: 'wits', value: 1 },
      ],
      score: 8,
    });
  });

  it('lists meter and asset meter sources with their base value', () => {
    expect(scoreBreakdown(roll({ meter: 'supply', baseValue: 3 }))).toEqual({
      terms: [
        { kind: 'die', value: 7 },
        { kind: 'meter', id: 'supply', value: 3 },
      ],
      score: 8,
    });
    expect(
      scoreBreakdown(roll({ assetMeter: { assetId: 'asset-0', control: 'health' }, baseValue: 4 })),
    ).toEqual({
      terms: [
        { kind: 'die', value: 7 },
        { kind: 'assetMeter', assetId: 'asset-0', control: 'health', value: 4 },
      ],
      score: 8,
    });
  });

  it('includes non-zero adds only and supports base-less rolls', () => {
    expect(
      scoreBreakdown(roll({ stat: undefined, baseValue: 0, add: 2, score: 9, rawScore: 9 })),
    ).toEqual({
      terms: [
        { kind: 'die', value: 7 },
        { kind: 'add', value: 2 },
      ],
      score: 9,
    });
    expect(
      scoreBreakdown(roll({ stat: undefined, baseValue: 0, add: 0, score: 7, rawScore: 7 })).terms,
    ).toEqual([{ kind: 'die', value: 7 }]);
  });

  it('drops the die term when negative momentum cancels it', () => {
    expect(
      scoreBreakdown(roll({ stat: 'iron', canceledActionDie: true, rawScore: 1, score: 1 })),
    ).toEqual({
      terms: [{ kind: 'stat', id: 'iron', value: 1 }],
      score: 1,
    });
  });

  it('flags raw totals that were clamped into [0, 10]', () => {
    expect(
      scoreBreakdown(roll({ stat: 'wits', baseValue: 5, add: 3, rawScore: 15, score: 10 })),
    ).toEqual({
      terms: [
        { kind: 'die', value: 7 },
        { kind: 'stat', id: 'wits', value: 5 },
        { kind: 'add', value: 3 },
      ],
      score: 10,
      raw: 15,
    });
    expect(scoreBreakdown(roll({ stat: 'wits', add: -5, rawScore: 3, score: 3 }))).toEqual({
      terms: [
        { kind: 'die', value: 7 },
        { kind: 'stat', id: 'wits', value: 1 },
        { kind: 'add', value: -5 },
      ],
      score: 3,
    });
  });

  it('replaces all terms with momentum when momentum is burned', () => {
    expect(scoreBreakdown(roll({ burned: true, baseValue: 3, rawScore: 4, score: 8 }))).toEqual({
      terms: [{ kind: 'burn', value: 8 }],
      score: 8,
    });
  });
});

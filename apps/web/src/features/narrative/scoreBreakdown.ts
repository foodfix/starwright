import type { ActionRollOutcome } from '@starwright/engine';

export type BreakdownTerm =
  | { kind: 'die'; value: number }
  | { kind: 'stat'; id: string; value: number }
  | { kind: 'meter'; id: string; value: number }
  | { kind: 'assetMeter'; assetId: string; control: string; value: number }
  | { kind: 'add'; value: number }
  | { kind: 'burn'; value: number };

export interface ScoreBreakdown {
  /** ordered additive terms of the action score (die → source → adds) */
  terms: BreakdownTerm[];
  /** final clamped score used for the outcome comparison */
  score: number;
  /** present when the raw total fell outside [0, 10] and was clamped */
  raw?: number;
}

/**
 * Decompose an action roll score into its additive terms so the settlement
 * card can show where every point came from. Burn replaces the whole score
 * with momentum (never clamped, momentum ≤ 10); a die canceled by negative
 * momentum contributes no die term.
 */
export function scoreBreakdown(outcome: ActionRollOutcome): ScoreBreakdown {
  if (outcome.burned) {
    return { terms: [{ kind: 'burn', value: outcome.score }], score: outcome.score };
  }
  const terms: BreakdownTerm[] = [];
  if (!outcome.canceledActionDie) {
    terms.push({ kind: 'die', value: outcome.dice.actionDie });
  }
  if (outcome.stat !== undefined) {
    terms.push({ kind: 'stat', id: outcome.stat, value: outcome.baseValue });
  } else if (outcome.meter !== undefined) {
    terms.push({ kind: 'meter', id: outcome.meter, value: outcome.baseValue });
  } else if (outcome.assetMeter !== undefined) {
    terms.push({
      kind: 'assetMeter',
      assetId: outcome.assetMeter.assetId,
      control: outcome.assetMeter.control,
      value: outcome.baseValue,
    });
  }
  if (outcome.add !== 0) {
    terms.push({ kind: 'add', value: outcome.add });
  }
  return outcome.rawScore === outcome.score
    ? { terms, score: outcome.score }
    : { terms, score: outcome.score, raw: outcome.rawScore };
}

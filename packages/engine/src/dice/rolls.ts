import type { ConditionMeterId, StatId } from '@starwright/data';

export type OutcomeKind = 'strong_hit' | 'weak_hit' | 'miss';

export interface ActionDice {
  actionDie: number;
  challenge: [number, number];
}

export interface AssetMeterSelection {
  /** asset instance id (CampaignState.assets[].id) */
  assetId: string;
  /** control key of an asset condition meter (integrity/health/shields…) */
  control: string;
}

export interface ActionRollInput {
  stat?: StatId;
  meter?: ConditionMeterId;
  /** M5: roll with an asset condition meter (asset_control triggers) */
  assetMeter?: AssetMeterSelection;
  add?: number;
  momentumBurn?: boolean;
}

export interface ActionRollContext {
  /** base value of the chosen stat or condition meter (0-5) */
  baseValue: number;
  momentum: number;
}

export interface ActionResult {
  dice: ActionDice;
  stat?: StatId;
  meter?: ConditionMeterId;
  assetMeter?: AssetMeterSelection;
  /** base value of the chosen stat, condition meter or asset meter (kept for burn re-evaluation) */
  baseValue: number;
  add: number;
  /** score before the 0-10 clamp (after negative-momentum cancellation, before burn) */
  rawScore: number;
  /** final score used for outcome comparison, clamped to [0, 10] */
  score: number;
  canceledActionDie: boolean;
  match: boolean;
  outcome: OutcomeKind;
  burned: boolean;
}

export interface ProgressResult {
  dice: { challenge: [number, number] };
  score: number;
  match: boolean;
  outcome: OutcomeKind;
}

export function rollDie(rng: () => number, sides: number): number {
  return Math.floor(rng() * sides) + 1;
}

export function rollChallengePair(rng: () => number): [number, number] {
  return [rollDie(rng, 10), rollDie(rng, 10)];
}

/**
 * Starforged action roll:
 * - score = action die + stat (or condition meter) + adds, clamped to [0, 10]
 * - negative momentum whose absolute value equals the action die cancels the die
 * - burning momentum replaces the score with the (positive) momentum value
 * - match = both challenge dice show the same value
 */
export function computeActionRoll(
  input: ActionRollInput,
  dice: ActionDice,
  ctx: ActionRollContext,
): ActionResult {
  const add = input.add ?? 0;
  let canceled = false;
  let raw = dice.actionDie + ctx.baseValue + add;
  if (ctx.momentum < 0 && Math.abs(ctx.momentum) === dice.actionDie) {
    canceled = true;
    raw = ctx.baseValue + add;
  }
  const burned = input.momentumBurn === true && ctx.momentum > 0;
  if (burned) {
    raw = ctx.momentum;
  }
  const score = Math.min(10, Math.max(0, raw));
  const [c1, c2] = dice.challenge;
  const match = c1 === c2;
  const high = Math.max(c1, c2);
  const low = Math.min(c1, c2);
  const outcome: OutcomeKind = score > high ? 'strong_hit' : score > low ? 'weak_hit' : 'miss';
  return {
    dice,
    stat: input.stat,
    meter: input.meter,
    assetMeter: input.assetMeter,
    baseValue: ctx.baseValue,
    add,
    rawScore: canceled ? ctx.baseValue + add : dice.actionDie + ctx.baseValue + add,
    score,
    canceledActionDie: canceled,
    match,
    outcome,
    burned,
  };
}

/**
 * Starforged progress roll: challenge dice only; score is the number of filled
 * boxes; momentum is ignored entirely (no burn, no negative-momentum cancel).
 */
export function computeProgressRoll(score: number, challenge: [number, number]): ProgressResult {
  const [c1, c2] = challenge;
  const match = c1 === c2;
  const high = Math.max(c1, c2);
  const low = Math.min(c1, c2);
  const outcome: OutcomeKind = score > high ? 'strong_hit' : score > low ? 'weak_hit' : 'miss';
  return { dice: { challenge }, score, match, outcome };
}

export function compareOutcome(score: number, challenge: [number, number]): OutcomeKind {
  const high = Math.max(challenge[0], challenge[1]);
  const low = Math.min(challenge[0], challenge[1]);
  return score > high ? 'strong_hit' : score > low ? 'weak_hit' : 'miss';
}

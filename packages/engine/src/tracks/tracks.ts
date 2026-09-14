import type { ChallengeRank } from '../state/types.js';

export const TICKS_PER_BOX = 4;
export const TRACK_TICKS_MAX = 40;
export const LEGACY_TICKS_MAX = 40;

/** Ticks added per "mark progress", by challenge rank (Rules Summary p3). */
export const MARK_TICKS_BY_RANK: Record<ChallengeRank, number> = {
  troublesome: 12,
  dangerous: 8,
  formidable: 4,
  extreme: 2,
  epic: 1,
};

export function progressScore(ticks: number, cleared = false): number {
  if (cleared) return 10;
  return Math.floor(ticks / TICKS_PER_BOX);
}

export function ticksForMarks(rank: ChallengeRank | null, marks: number): number | undefined {
  if (rank === null) return undefined;
  return MARK_TICKS_BY_RANK[rank] * marks;
}

export function clampTicks(ticks: number): number {
  return Math.min(TRACK_TICKS_MAX, Math.max(0, ticks));
}

/**
 * Legacy reward ticks per challenge rank (Fulfill Your Vow / Forge a Bond /
 * Finish an Expedition): troublesome=1 tick, dangerous=2 ticks, formidable=1
 * box, extreme=2 boxes, epic=3 boxes. `levelsDown` shifts one rank lower
 * ("make the reward one rank lower"); below troublesome the reward is 0.
 */
const LEGACY_REWARD_TICKS: Record<ChallengeRank, number> = {
  troublesome: 1,
  dangerous: 2,
  formidable: 4,
  extreme: 8,
  epic: 12,
};

export function legacyRewardTicks(rank: ChallengeRank, levelsDown = 0): number {
  const ranks: ChallengeRank[] = ['troublesome', 'dangerous', 'formidable', 'extreme', 'epic'];
  const index = ranks.indexOf(rank) - levelsDown;
  if (index < 0) return 0;
  const reward = LEGACY_REWARD_TICKS[ranks[index] as ChallengeRank];
  return reward ?? 0;
}

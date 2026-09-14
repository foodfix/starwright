import type { NewCampaignInput } from '@starwright/engine';
import type { ChallengeRank } from '@starwright/engine';
import type { StarforgedIndex } from '@starwright/data';

export const CHALLENGE_RANKS = [
  'troublesome',
  'dangerous',
  'formidable',
  'extreme',
  'epic',
] as const;

export const STAT_IDS = ['edge', 'heart', 'iron', 'shadow', 'wits'] as const;

export type StatId = (typeof STAT_IDS)[number];

/** Primer p8: each stat 1-3; the standard creation array {3,2,2,1,1} */
export const STAT_POOL = [3, 2, 2, 1, 1] as const;

export const INITIAL_ASSET_COUNT = 3;

export const STARSHIP_ASSET_ID = 'starforged/assets/command_vehicle/starship';

/** player-set content flags (Set a Flag): at most 10 entries of 120 chars */
export const MAX_FLAGS = 10;
export const MAX_FLAG_LENGTH = 120;

/** player-written character background: one free-text paragraph, 2000 chars */
export const MAX_BACKGROUND_LENGTH = 2000;

export interface WizardInput {
  characterName: string;
  /** optional player-written backstory; '' = unset */
  background: string;
  truths: Record<string, string>;
  /** synthetic sub-table id (`starforged/truths/<key>/<option>`) → resolved row text */
  truthDetails?: Record<string, string>;
  stats: Record<StatId, number>;
  backgroundVow: { title: string; rank: ChallengeRank | null } | null;
  assetIds: string[];
  /** player-set content flags (Set a Flag); may be empty */
  flags: string[];
}

export interface WizardValidation {
  ok: boolean;
  errors: string[];
  input: NewCampaignInput | null;
}

function multisetEqual(a: number[], b: number[]): boolean {
  const sorted = (values: number[]) => [...values].sort((x, y) => x - y);
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

function keyOfTruth(truthId: string): string {
  return truthId.split('/').pop() ?? truthId;
}

export function validateWizardInput(raw: WizardInput, index: StarforgedIndex): WizardValidation {
  const errors: string[] = [];
  if (raw.characterName.trim().length === 0) {
    errors.push('Enter a character name.');
  }
  for (const truth of index.listTruths()) {
    if (raw.truths[keyOfTruth(truth._id)] === undefined) {
      errors.push(`Choose a truth for “${truth.name}”.`);
    }
  }
  if (!multisetEqual(Object.values(raw.stats), [...STAT_POOL])) {
    errors.push(`Assign the stats as {3, 2, 2, 1, 1}, each value used once.`);
  }
  for (const [stat, value] of Object.entries(raw.stats)) {
    if (value < 1 || value > 3) errors.push(`Stat ${stat} must be between 1 and 3.`);
  }
  const uniqueAssets = [...new Set(raw.assetIds)];
  if (uniqueAssets.includes(STARSHIP_ASSET_ID)) {
    // the command vehicle ships with every campaign; picking it again would
    // create a duplicate instance
    errors.push('The Starship is already part of your starting kit — pick 3 other assets.');
  }
  if (uniqueAssets.length !== INITIAL_ASSET_COUNT) {
    errors.push(`Pick exactly ${INITIAL_ASSET_COUNT} assets.`);
  }
  for (const assetId of uniqueAssets) {
    if (!index.getAsset(assetId)) errors.push(`Unknown asset: ${assetId}`);
  }
  if (raw.backgroundVow) {
    if (raw.backgroundVow.title.trim().length === 0) {
      errors.push('The background vow needs a title (or clear it).');
    }
  }
  const background = raw.background.trim();
  if (background.length > MAX_BACKGROUND_LENGTH) {
    errors.push(`The character background must be at most ${MAX_BACKGROUND_LENGTH} characters.`);
  }
  const flags: string[] = [];
  for (const flag of raw.flags) {
    const trimmed = flag.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > MAX_FLAG_LENGTH) {
      errors.push(`Each flag must be at most ${MAX_FLAG_LENGTH} characters.`);
    }
    if (!flags.includes(trimmed)) flags.push(trimmed);
  }
  if (flags.length > MAX_FLAGS) {
    errors.push(`Set at most ${MAX_FLAGS} flags.`);
  }
  if (errors.length > 0) return { ok: false, errors, input: null };
  const input: NewCampaignInput = {
    characterName: raw.characterName.trim(),
    stats: { ...raw.stats },
    truths: { ...raw.truths },
    assets: [STARSHIP_ASSET_ID, ...uniqueAssets],
    contentFlags: flags,
    index,
    ...(background ? { background } : {}),
    ...(raw.backgroundVow ? { backgroundVow: raw.backgroundVow } : {}),
  };
  return { ok: true, errors: [], input };
}

/** the opening prompt sent to the GM right after the wizard completes */
export function buildOpeningPrompt(raw: WizardInput, index: StarforgedIndex): string {
  const lines: string[] = [];
  lines.push(
    'Begin the campaign: this is the opening scene. Set the stage and address the character directly.',
  );
  const truthLines: string[] = [];
  for (const truth of index.listTruths()) {
    const key = keyOfTruth(truth._id);
    const optionIndex = raw.truths[key];
    if (optionIndex === undefined) continue;
    const option = truth.options[Number(optionIndex)];
    if (!option) continue;
    const detail = raw.truthDetails?.[`${truth._id}/${optionIndex}`];
    truthLines.push(
      detail
        ? `- ${truth.name}: ${option.summary} (${detail})`
        : `- ${truth.name}: ${option.summary}`,
    );
  }
  if (truthLines.length > 0) {
    lines.push('Setting truths:', ...truthLines);
  }
  if (raw.flags.length > 0) {
    lines.push(
      'Content flags (player-set boundaries per Set a Flag — keep these out of the story or touch them only at a distance):',
      ...raw.flags.map((flag) => `- ${flag}`),
    );
  }
  if (raw.backgroundVow && raw.backgroundVow.title.trim().length > 0) {
    lines.push(
      `Background vow (${raw.backgroundVow.rank ?? 'no rank'}): “${raw.backgroundVow.title.trim()}” — it exists as a vow track already; weave it into the opening.`,
    );
  }
  const background = raw.background.trim();
  if (background.length > 0) {
    lines.push(
      'Character background (player-written — treat as canon and weave it into the campaign):',
      background,
    );
  }
  lines.push('Open scene 1: introduce the situation, then hand control back to the player.');
  return lines.join('\n');
}

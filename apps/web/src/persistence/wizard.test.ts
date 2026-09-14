import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadStarforged } from '@starwright/data';
import {
  buildOpeningPrompt,
  validateWizardInput,
  MAX_BACKGROUND_LENGTH,
  MAX_FLAGS,
  STARSHIP_ASSET_ID,
  type WizardInput,
} from './wizard.js';

const raw: unknown = JSON.parse(
  readFileSync(new URL('../../../../data/starforged.json', import.meta.url), 'utf8'),
);
const index = loadStarforged(raw).index;

function baseInput(): WizardInput {
  const truths: Record<string, string> = {};
  for (const truth of index.listTruths()) {
    truths[truth._id.split('/').pop() ?? ''] = '0';
  }
  return {
    characterName: 'Raven Calloway',
    background: 'Raised in the Terminus quarries; stole a ship and ran.',
    truths,
    stats: { edge: 3, heart: 2, iron: 2, shadow: 1, wits: 1 },
    backgroundVow: { title: 'Find my sister', rank: 'dangerous' },
    assetIds: [
      'starforged/assets/path/veteran',
      'starforged/assets/companion/sidekick',
      'starforged/assets/module/medbay',
    ],
    flags: [],
  };
}

describe('validateWizardInput', () => {
  it('accepts a complete wizard input and prepends the Starship', () => {
    const result = validateWizardInput(baseInput(), index);
    expect(result.ok).toBe(true);
    expect(result.input).not.toBeNull();
    expect(result.input?.assets).toEqual([
      STARSHIP_ASSET_ID,
      'starforged/assets/path/veteran',
      'starforged/assets/companion/sidekick',
      'starforged/assets/module/medbay',
    ]);
    expect(result.input?.backgroundVow).toEqual({ title: 'Find my sister', rank: 'dangerous' });
  });

  it('rejects stats that are not the {3,2,2,1,1} multiset', () => {
    const input = baseInput();
    input.stats = { edge: 3, heart: 3, iron: 3, shadow: 3, wits: 3 };
    const result = validateWizardInput(input, index);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('{3, 2, 2, 1, 1}'))).toBe(true);
  });

  it('rejects wrong asset counts and duplicates', () => {
    const input = baseInput();
    input.assetIds = ['starforged/assets/path/veteran'];
    expect(validateWizardInput(input, index).ok).toBe(false);
    input.assetIds = [
      'starforged/assets/path/veteran',
      'starforged/assets/path/veteran',
      'starforged/assets/module/medbay',
    ];
    expect(validateWizardInput(input, index).ok).toBe(false);
  });

  it('rejects picking the Starship as one of the three assets', () => {
    const input = baseInput();
    input.assetIds = [
      STARSHIP_ASSET_ID,
      'starforged/assets/companion/sidekick',
      'starforged/assets/module/medbay',
    ];
    const result = validateWizardInput(input, index);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Starship'))).toBe(true);
    expect(result.input).toBeNull();
  });

  it('rejects unknown assets and empty names', () => {
    const input = baseInput();
    input.assetIds = ['starforged/assets/path/veteran', 'starforged/assets/path/nonexistent', 'x'];
    const result = validateWizardInput(input, index);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Unknown asset'))).toBe(true);
    const nameless = baseInput();
    nameless.characterName = '  ';
    expect(validateWizardInput(nameless, index).ok).toBe(false);
  });

  it('rejects a vow without a title but allows clearing the vow', () => {
    const input = baseInput();
    input.backgroundVow = { title: ' ', rank: 'dangerous' };
    expect(validateWizardInput(input, index).ok).toBe(false);
    input.backgroundVow = null;
    const result = validateWizardInput(input, index);
    expect(result.ok).toBe(true);
    expect(result.input?.backgroundVow).toBeUndefined();
  });

  it('passes a trimmed background through and omits it when empty', () => {
    const input = baseInput();
    input.background = '  Stole a ship and ran.  ';
    const result = validateWizardInput(input, index);
    expect(result.ok).toBe(true);
    expect(result.input?.background).toBe('Stole a ship and ran.');
    const quiet = baseInput();
    quiet.background = '   ';
    const quietResult = validateWizardInput(quiet, index);
    expect(quietResult.ok).toBe(true);
    expect(quietResult.input?.background).toBeUndefined();
  });

  it('rejects a background longer than MAX_BACKGROUND_LENGTH', () => {
    const input = baseInput();
    input.background = 'x'.repeat(MAX_BACKGROUND_LENGTH + 1);
    const result = validateWizardInput(input, index);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('background'))).toBe(true);
  });

  it('requires every truth to be chosen', () => {
    const input = baseInput();
    delete input.truths['cataclysm'];
    const result = validateWizardInput(input, index);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Cataclysm'))).toBe(true);
  });

  it('normalizes flags (trim, drop empties, dedupe) into contentFlags', () => {
    const input = baseInput();
    input.flags = ['  graphic body horror ', '', 'graphic body horror', 'torture  '];
    const result = validateWizardInput(input, index);
    expect(result.ok).toBe(true);
    expect(result.input?.contentFlags).toEqual(['graphic body horror', 'torture']);
  });

  it('rejects more than MAX_FLAGS or overlong flags', () => {
    const input = baseInput();
    input.flags = Array.from({ length: MAX_FLAGS + 1 }, (_, i) => `flag ${i}`);
    expect(validateWizardInput(input, index).ok).toBe(false);
    const long = baseInput();
    long.flags = ['x'.repeat(121)];
    expect(validateWizardInput(long, index).ok).toBe(false);
  });
});

describe('buildOpeningPrompt', () => {
  it('contains truth summaries and the background vow, but no quest starters', () => {
    const input = baseInput();
    const prompt = buildOpeningPrompt(input, index);
    expect(prompt).toContain('opening scene');
    expect(prompt).toContain('Background vow (dangerous): “Find my sister”');
    expect(prompt).toContain('Character background (player-written');
    expect(prompt).toContain('Raised in the Terminus quarries');
    expect(prompt).not.toContain('Quest starter:');
    const cataclysm = index.getTruth('cataclysm');
    expect(prompt).toContain(cataclysm?.options[0]?.summary ?? 'never');
  });

  it('omits the character background block when none was written', () => {
    const input = baseInput();
    input.background = '';
    expect(buildOpeningPrompt(input, index)).not.toContain('Character background');
  });

  it('lists player-set content flags as GM boundaries and omits the block when empty', () => {
    const input = baseInput();
    input.flags = ['graphic body horror', 'torture'];
    const prompt = buildOpeningPrompt(input, index);
    expect(prompt).toContain('Content flags (player-set boundaries per Set a Flag');
    expect(prompt).toContain('- graphic body horror');
    expect(prompt).toContain('- torture');
    const flagless = baseInput();
    expect(buildOpeningPrompt(flagless, index)).not.toContain('Content flags');
  });

  it('appends a chosen sub-table detail of the selected option to its truth line', () => {
    const input = baseInput();
    input.truthDetails = {
      'starforged/truths/cataclysm/0': 'Superweapon run amok',
      'starforged/truths/cataclysm/1': 'stale — option 1 not chosen',
    };
    const prompt = buildOpeningPrompt(input, index);
    expect(prompt).toContain(
      '- Cataclysm: The Sun Plague extinguished the stars in our home galaxy. (Superweapon run amok)',
    );
    expect(prompt).not.toContain('stale');
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadStarforged, findRowByRoll, type Starforged } from './index.js';

const raw: unknown = JSON.parse(
  readFileSync(new URL('../../../data/starforged.json', import.meta.url), 'utf8'),
);

let loaded: { index: ReturnType<typeof loadStarforged>['index']; warnings: string[] };
let data: Starforged;

beforeAll(() => {
  loaded = loadStarforged(raw);
  data = loaded.index.data;
});

describe('loadStarforged', () => {
  it('parses the real Datasworn file and skips empty domains with warnings', () => {
    for (const domain of ['atlas', 'rarities', 'delve_sites', 'site_domains', 'site_themes']) {
      expect(loaded.warnings).toContain(`skipped empty domain "${domain}"`);
    }
    expect(loaded.warnings).toContain('skipped unsupported domain "npcs"');
  });

  it('exposes parsed rules', () => {
    expect(Object.keys(data.rules.stats).sort()).toEqual(['edge', 'heart', 'iron', 'shadow', 'wits']);
    expect(Object.keys(data.rules.condition_meters)).toEqual(['health', 'spirit', 'supply']);
    expect(data.rules.condition_meters['health']?.max).toBe(5);
    expect(Object.keys(data.rules.impacts.misfortunes?.contents ?? {})).toContain('wounded');
    expect(data.rules.impacts.misfortunes?.contents['wounded']?.prevents_recovery).toEqual(['health']);
  });

  it('indexes nodes by id', () => {
    expect(loaded.index.byId.size).toBeGreaterThan(200);
    expect(loaded.index.getMove('nonexistent')).toBeUndefined();
    expect(loaded.index.getOracle('nonexistent')).toBeUndefined();
  });
});

describe('moves index', () => {
  it('catalogs 12 categories and 56 moves (M5: +1 Assets category, 12 embedded)', () => {
    const tree = loaded.index.listMoves();
    const core = tree.filter((cat) => cat.name !== 'Assets');
    expect(core).toHaveLength(12);
    const total = core.reduce((sum, cat) => sum + cat.moves.length, 0);
    expect(total).toBe(56);
    const assets = tree.find((cat) => cat.name === 'Assets');
    expect(assets?.moves).toHaveLength(12);
    expect(tree.reduce((sum, cat) => sum + cat.moves.length, 0)).toBe(68);
  });

  it('registers embedded asset moves (M5)', () => {
    const shields = loaded.index.getMove(
      'starforged/assets/module/shields/abilities/0/moves/raise_shields',
    );
    expect(shields?.name).toBe('Raise Shields');
    expect(shields?.roll_type).toBe('action_roll');
    const haven = loaded.index.getMove(
      'starforged/assets/deed/vanguard/abilities/0/moves/seek_safe_haven',
    );
    expect(haven?.roll_type).toBe('special_track');
    expect(shields?.outcomes?.['weak_hit']?.text).toContain('shields to 3');
  });

  it('spot-checks face_danger trigger', () => {
    const move = loaded.index.getMove('starforged/moves/adventure/face_danger');
    expect(move).toBeDefined();
    expect(move?.name).toBe('Face Danger');
    expect(move?.roll_type).toBe('action_roll');
    const conditions = move?.trigger?.conditions ?? [];
    expect(conditions).toHaveLength(5);
    for (const condition of conditions) {
      expect(condition.method).toBe('player_choice');
      expect(condition.roll_options).toHaveLength(1);
      expect(condition.roll_options?.[0]?.using).toBe('stat');
    }
    expect(move?.outcomes?.['strong_hit']?.text).toContain('strong hit');
  });

  it('covers no_roll and special_track roll types', () => {
    const begin = loaded.index.getMove('starforged/moves/session/begin_a_session');
    expect(begin?.roll_type).toBe('no_roll');
    expect(begin?.outcomes).toBeNull();
    const rollTypes = new Set<string>();
    for (const cat of loaded.index.listMoves()) {
      for (const entry of cat.moves) rollTypes.add(entry.rollType);
    }
    expect(rollTypes).toContain('special_track');
  });
});

describe('oracles index', () => {
  it('spot-checks core/action rows', () => {
    const oracle = loaded.index.getOracle('starforged/oracles/core/action');
    expect(oracle?.name).toBe('Action');
    expect(oracle?.rows).toHaveLength(100);
    expect(oracle?.rows[0]).toMatchObject({ min: 1, max: 1, text: 'Abandon' });
    expect(oracle?.rows[99]).toMatchObject({ min: 100, max: 100 });
  });

  it('preprocesses rows into sorted contiguous 1..100 intervals', () => {
    const rows = loaded.index.getOracleRows('starforged/oracles/core/action');
    expect(rows).toHaveLength(100);
    let expected = 1;
    for (const row of rows ?? []) {
      expect(row.min).toBe(expected);
      expect(row.max).toBeGreaterThanOrEqual(row.min);
      expected = row.max + 1;
    }
    expect(expected).toBe(101);
  });

  it('binary-searches rows by roll', () => {
    const rows = loaded.index.getOracleRows('starforged/oracles/core/action') ?? [];
    expect(findRowByRoll(rows, 1)?.text).toBe('Abandon');
    expect(findRowByRoll(rows, 50)).toBeDefined();
    expect(findRowByRoll(rows, 100)).toBe(rows[99]);
    expect(findRowByRoll(rows, 0)).toBeUndefined();
    expect(findRowByRoll(rows, 101)).toBeUndefined();
  });

  it('builds an oracle tree with breadcrumbs', () => {
    const tree = loaded.index.listOracleTree();
    expect(tree).toHaveLength(14);
    const core = tree.find((c) => c.id === 'starforged/collections/oracles/core');
    expect(core?.name).toBe('Core Oracles');
    const action = core?.contents.find(
      (n): n is Extract<typeof n, { kind: 'rollable' }> => n.kind === 'rollable' && n.id === 'starforged/oracles/core/action',
    );
    expect(action?.breadcrumbs).toEqual(['Core Oracles']);
  });
});

describe('assets index', () => {
  it('spot-checks the starship asset', () => {
    const asset = loaded.index.getAsset('starforged/assets/command_vehicle/starship');
    expect(asset?.name).toBe('Starship');
    expect(asset?.abilities).toHaveLength(3);
    expect(asset?.abilities[0]?.enabled).toBe(true);
    expect(asset?.abilities[1]?.enabled).toBe(false);
    expect(asset?.abilities[1]?.enhance_moves?.[0]?.enhances).toEqual([
      'starforged/moves/exploration/finish_an_expedition',
    ]);
    const integrity = asset?.controls?.['integrity'];
    expect(integrity?.max).toBe(5);
    expect(integrity?.controls?.['battered']?.is_impact).toBe(true);
  });

  it('catalogs 6 categories with 87 assets', () => {
    const categories = new Set<string>();
    let count = 0;
    for (const cat of Object.values(data.assets)) {
      categories.add(cat._id);
      count += Object.keys(cat.contents).length;
    }
    expect(categories.size).toBe(6);
    expect(count).toBe(87);
  });

  it('builds an asset tree for the wizard (M4)', () => {
    const tree = loaded.index.listAssetTree();
    expect(tree).toHaveLength(6);
    const total = tree.reduce((sum, cat) => sum + cat.assets.length, 0);
    expect(total).toBe(87);
    const vehicles = tree.find((cat) => cat.id === 'starforged/collections/assets/command_vehicle');
    expect(vehicles?.name).toBe('Command Vehicle Assets');
    const starship = vehicles?.assets.find((a) => a.id === 'starforged/assets/command_vehicle/starship');
    expect(starship?.name).toBe('Starship');
    expect(starship?.category).toBe('Command Vehicle');
    expect(starship?.firstAbility).toContain('multipurpose starship');
    expect(starship?.optionLabels).toEqual(['name']);
  });
});

describe('truths index', () => {
  it('spot-checks the cataclysm truth and its sub-table', () => {
    const truth = loaded.index.getTruth('cataclysm');
    expect(truth?.name).toBe('Cataclysm');
    expect(truth?.options).toHaveLength(3);
    const first = truth?.options[0];
    expect(first?.summary).toContain('Sun Plague');
    expect(first?.table?.rows).toHaveLength(4);
  });

  it('registers synthetic truth sub-table ids for {{table:...}} resolution', () => {
    const table = loaded.index.getOracle('starforged/truths/cataclysm/0');
    expect(table).toBeDefined();
    const rows = loaded.index.getOracleRows('starforged/truths/cataclysm/0');
    expect(rows).toHaveLength(4);
    expect(rows?.every((r) => r.max > r.min)).toBe(true);
    expect(findRowByRoll(rows ?? [], 1)?.text).toBe('Temporal distortions from a supermassive black hole');
    expect(findRowByRoll(rows ?? [], 25)?.text).toBe('Temporal distortions from a supermassive black hole');
    expect(findRowByRoll(rows ?? [], 26)?.text).toBe('Sudden dark matter decay');
    expect(findRowByRoll(rows ?? [], 63)?.text).toBe('Superweapon run amok');
    expect(findRowByRoll(rows ?? [], 100)?.text).toBe('Scientific experiment gone awry');
  });

  it('synthesizes the Ask the Oracle odds tables missing from Datasworn (M4)', () => {
    const rows = loaded.index.getOracleRows('starforged/oracles/moves/ask_the_oracle/fifty_fifty');
    expect(rows).toEqual([
      { min: 1, max: 50, text: 'Yes' },
      { min: 51, max: 100, text: 'No' },
    ]);
    expect(findRowByRoll(rows ?? [], 50)?.text).toBe('Yes');
    expect(findRowByRoll(rows ?? [], 51)?.text).toBe('No');
    expect(findRowByRoll(loaded.index.getOracleRows('starforged/oracles/moves/ask_the_oracle/almost_certain') ?? [], 90)?.text).toBe('Yes');
    expect(findRowByRoll(loaded.index.getOracleRows('starforged/oracles/moves/ask_the_oracle/almost_certain') ?? [], 91)?.text).toBe('No');
    expect(loaded.index.getOracle('starforged/oracles/moves/ask_the_oracle/small_chance')).toBeDefined();
  });

  it('lists all 14 truths', () => {
    expect(loaded.index.listTruths()).toHaveLength(14);
  });
});

describe('localized dataset (starforged.zh.json)', () => {
  const zhRaw: unknown = JSON.parse(
    readFileSync(new URL('../../../data/starforged.zh.json', import.meta.url), 'utf8'),
  );
  let zh: ReturnType<typeof loadStarforged>['index'];

  beforeAll(() => {
    zh = loadStarforged(zhRaw).index;
  });

  it('parses and indexes the same shape of content as the English dataset', () => {
    expect(zh.data._id).toBe('starforged');
    expect(zh.byId.size).toBe(loaded.index.byId.size + 1); // +1: nested ask_the_oracle collection
    expect(zh.listMoves()).toHaveLength(loaded.index.listMoves().length);
    expect(zh.listTruths()).toHaveLength(loaded.index.listTruths().length);
    let zhAssets = 0;
    for (const cat of Object.values(zh.data.assets)) zhAssets += Object.keys(cat.contents).length;
    expect(zhAssets).toBe(87);
  });

  it('provides localized Ask the Oracle tables instead of English synthesis', () => {
    const rows = zh.getOracleRows('starforged/oracles/moves/ask_the_oracle/fifty_fifty');
    expect(rows).toEqual([
      { min: 1, max: 50, text: '是' },
      { min: 51, max: 100, text: '否' },
    ]);
    expect(zh.getOracle('starforged/oracles/moves/ask_the_oracle/almost_certain')?.name).toContain(
      '几乎必然',
    );
  });

  it('translates display text while keeping ids untouched', () => {
    const move = zh.getMove('starforged/moves/adventure/face_danger');
    expect(move).toBeDefined();
    expect(move?._id).toBe('starforged/moves/adventure/face_danger');
    expect(move?.name).not.toBe('Face Danger');
    expect(move?.roll_type).toBe('action_roll');
    const oracle = zh.getOracle('starforged/oracles/core/action');
    expect(oracle?._id).toBe('starforged/oracles/core/action');
    expect(oracle?.rows).toHaveLength(100);
    expect(oracle?.rows[0]?.text).not.toBe('Abandon');
    expect(oracle?.rows[0]?.min).toBe(1);
    const asset = zh.getAsset('starforged/assets/command_vehicle/starship');
    expect(asset?._id).toBe('starforged/assets/command_vehicle/starship');
    expect(asset?.abilities).toHaveLength(3);
    expect(asset?.abilities[0]?.enabled).toBe(true);
  });
});

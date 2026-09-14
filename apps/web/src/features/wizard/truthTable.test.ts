import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadStarforged } from '@starwright/data';
import { rollTruthTableRow } from './truthTable.js';

const raw: unknown = JSON.parse(
  readFileSync(new URL('../../../../../data/starforged.json', import.meta.url), 'utf8'),
);
const index = loadStarforged(raw).index;

describe('rollTruthTableRow', () => {
  it('rolls every row of a truth sub-table across the full 1d100 range', () => {
    const rows = index.getOracleRows('starforged/truths/cataclysm/0') ?? [];
    expect(rows.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const row = rollTruthTableRow(rows, Math.random);
      expect(row).toBeDefined();
      if (row) seen.add(row.text);
    }
    expect(seen.size).toBe(rows.length);
  });

  it('always returns a row (roll stays within 1..100)', () => {
    const rows = index.getOracleRows('starforged/truths/artificial_intelligence/0') ?? [];
    expect(rollTruthTableRow(rows, () => 0)?.text).toContain('corrupt advanced systems');
    expect(rollTruthTableRow(rows, () => 0.999)?.text).toContain('lost the knowledge');
  });
});

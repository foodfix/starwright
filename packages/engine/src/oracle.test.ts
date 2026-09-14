import { describe, expect, it } from 'vitest';
import type { OracleRow, StarforgedIndex } from '@starwright/data';
import { mulberry32 } from './dice/rng.js';
import { rollD100, rollOracle, ORACLE_EXPAND_DEPTH_LIMIT } from './oracle/oracle.js';
import { realIndex } from './test-support.js';

describe('rollD100', () => {
  it('produces rolls in [1, 100] with digit dice and match flag', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 2000; i++) {
      const { roll, dice, match } = rollD100(rng);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(100);
      expect(dice.tens).toBeGreaterThanOrEqual(0);
      expect(dice.tens).toBeLessThanOrEqual(9);
      expect(dice.units).toBeGreaterThanOrEqual(0);
      expect(dice.units).toBeLessThanOrEqual(9);
      expect(match).toBe(dice.tens === dice.units);
      const expected = dice.tens * 10 + dice.units;
      expect(roll).toBe(expected === 0 ? 100 : expected);
    }
  });

  it('is deterministic for a fixed seed', () => {
    expect(rollD100(mulberry32(123))).toEqual(rollD100(mulberry32(123)));
  });
});

describe('rollOracle with the real Datasworn index', () => {
  it('rolls the core action table', () => {
    const result = rollOracle('starforged/oracles/core/action', {
      index: realIndex,
      rng: mulberry32(99),
    });
    expect(result.tableId).toBe('starforged/oracles/core/action');
    expect(result.roll).toBeGreaterThanOrEqual(1);
    expect(result.roll).toBeLessThanOrEqual(100);
    expect(result.rowText.length).toBeGreaterThan(0);
    expect(result.text).toBe(result.rowText);
    expect(result.nested).toEqual([]);
  });

  it('rolls truth sub-tables registered under synthetic ids', () => {
    const result = rollOracle('starforged/truths/cataclysm/0', {
      index: realIndex,
      rng: mulberry32(5),
    });
    expect(result.roll).toBeGreaterThanOrEqual(1);
    expect(result.roll).toBeLessThanOrEqual(100);
    expect(result.rowText.length).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed seed', () => {
    const a = rollOracle('starforged/oracles/core/action', {
      index: realIndex,
      rng: mulberry32(1234),
    });
    const b = rollOracle('starforged/oracles/core/action', {
      index: realIndex,
      rng: mulberry32(1234),
    });
    expect(a).toEqual(b);
  });

  it('fails with a structured error for unknown tables', () => {
    try {
      rollOracle('starforged/oracles/nope', { index: realIndex, rng: mulberry32(1) });
      expect.unreachable('expected EngineFailure');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('unknown_table');
    }
  });

  it('rolls single-die tables within their declared range (regression: name_tags 1d10)', () => {
    for (let seed = 0; seed < 200; seed++) {
      const result = rollOracle('starforged/oracles/settlements/name_tags', {
        index: realIndex,
        rng: mulberry32(seed),
      });
      expect(result.roll).toBeGreaterThanOrEqual(1);
      expect(result.roll).toBeLessThanOrEqual(10);
      expect(result.match).toBe(false);
      expect(result.dice).toBeUndefined();
      expect(result.rowText.length).toBeGreaterThan(0);
    }
  });
});

describe('dice-aware rolling', () => {
  it('rolls 1..N for tables whose rows do not cover 1-100', () => {
    const tables: Record<string, OracleRow[]> = {
      d20: [
        { min: 1, max: 10, text: 'low half' },
        { min: 11, max: 20, text: 'high half' },
      ],
      d10: [
        { min: 1, max: 1, text: 'one' },
        { min: 2, max: 10, text: 'rest' },
      ],
    };
    for (let seed = 0; seed < 200; seed++) {
      const ctx = { index: stubIndex(tables), rng: mulberry32(seed) };
      const d20 = rollOracle('d20', ctx);
      expect(d20.roll).toBeGreaterThanOrEqual(1);
      expect(d20.roll).toBeLessThanOrEqual(20);
      expect(d20.match).toBe(false);
      const d10 = rollOracle('d10', ctx);
      expect(d10.roll).toBeGreaterThanOrEqual(1);
      expect(d10.roll).toBeLessThanOrEqual(10);
    }
  });
});

function stubIndex(tables: Record<string, OracleRow[]>): StarforgedIndex {
  return {
    getOracleRows: (id: string) => tables[id],
  } as unknown as StarforgedIndex;
}

describe('nested {{table:...}} expansion', () => {
  const tables: Record<string, OracleRow[]> = {
    t1: [{ min: 1, max: 100, text: 'A {{table:t2}} B' }],
    t2: [
      { min: 1, max: 50, text: 'X' },
      { min: 51, max: 100, text: 'Y {{table:t3}}' },
    ],
    t3: [{ min: 1, max: 100, text: 'Z' }],
  };

  it('substitutes nested rolls recursively', () => {
    const ctx = { index: stubIndex(tables), rng: mulberry32(3) };
    const result = rollOracle('t1', ctx);
    expect(result.nested).toHaveLength(1);
    const nested = result.nested[0]!;
    expect(nested.tableId).toBe('t2');
    if (nested.roll <= 50) {
      expect(result.text).toBe('A X B');
      expect(nested.nested).toEqual([]);
    } else {
      expect(result.text).toBe('A Y Z B');
      expect(nested.nested[0]?.tableId).toBe('t3');
    }
  });

  it('keeps the raw row text alongside the expanded text', () => {
    const ctx = { index: stubIndex(tables), rng: mulberry32(3) };
    const result = rollOracle('t1', ctx);
    expect(result.rowText).toBe('A {{table:t2}} B');
  });

  it('guards against runaway recursion with a depth limit', () => {
    const cyclic: Record<string, OracleRow[]> = {
      a: [{ min: 1, max: 100, text: 'roll {{table:b}}' }],
      b: [{ min: 1, max: 100, text: 'back to {{table:a}}' }],
    };
    const ctx = { index: stubIndex(cyclic), rng: mulberry32(3) };
    try {
      rollOracle('a', ctx);
      expect.unreachable('expected EngineFailure');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('oracle_depth_exceeded');
      expect((e as { message: string }).message).toContain(String(ORACLE_EXPAND_DEPTH_LIMIT));
    }
  });

  it('reports unknown nested tables with the failing id', () => {
    const ctx = {
      index: stubIndex({ a: [{ min: 1, max: 100, text: 'x {{table:missing}}' }] }),
      rng: mulberry32(3),
    };
    try {
      rollOracle('a', ctx);
      expect.unreachable('expected EngineFailure');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('unknown_table');
      expect((e as { message: string }).message).toContain('missing');
    }
  });
});

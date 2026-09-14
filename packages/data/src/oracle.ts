import type { OracleRow } from './schema/oracles.js';

export interface PreprocessedOracleTable {
  id: string;
  rows: OracleRow[];
}

export function preprocessRows(rows: OracleRow[]): OracleRow[] {
  return [...rows].sort((a, b) => a.min - b.min);
}

export function findRowByRoll(rows: OracleRow[], roll: number): OracleRow | undefined {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = lo + ((hi - lo) >> 1);
    const row = rows[mid];
    if (!row) return undefined;
    if (roll < row.min) {
      hi = mid - 1;
    } else if (roll > row.max) {
      lo = mid + 1;
    } else {
      return row;
    }
  }
  return undefined;
}

import { findRowByRoll, type OracleRow } from '@starwright/data';

/** 1d100 over the row ranges so each row's probability weight is preserved */
export function rollTruthTableRow(rows: OracleRow[], rng: () => number): OracleRow | undefined {
  return findRowByRoll(rows, 1 + Math.floor(rng() * 100));
}

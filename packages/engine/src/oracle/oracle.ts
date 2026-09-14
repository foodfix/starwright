import { findRowByRoll, type StarforgedIndex } from '@starwright/data';
import { rollDie } from '../dice/rolls.js';
import { EngineFailure } from '../state/create.js';

export interface OracleDice {
  tens: number;
  units: number;
}

export interface OracleRollRecord {
  tableId: string;
  roll: number;
  /** two d10 digit dice; only present for d100 tables */
  dice?: OracleDice;
  /** tens == units on a d100 roll (Ask the Oracle twist prompt); always false otherwise */
  match: boolean;
  rowText: string;
  /** row text with all nested {{table:...}} references rolled and substituted */
  text: string;
  suggestion?: string;
  nested: OracleRollRecord[];
}

export type OracleResult = OracleRollRecord;

export const ORACLE_EXPAND_DEPTH_LIMIT = 8;
const TABLE_MARKER = /\{\{table:([^}]+)\}\}/g;

export interface OracleContext {
  index: StarforgedIndex;
  rng: () => number;
}

function rollDigit(rng: () => number): number {
  return rollDie(rng, 10) % 10;
}

/**
 * d100 from two d10s (tens / units digits, a die showing 10 counts as 0; 00 = 100).
 * match = tens digit equals units digit (Ask the Oracle twist prompt).
 */
export function rollD100(rng: () => number): { roll: number; dice: OracleDice; match: boolean } {
  const tens = rollDigit(rng);
  const units = rollDigit(rng);
  const roll = tens * 10 + units === 0 ? 100 : tens * 10 + units;
  return { roll, dice: { tens, units }, match: tens === units };
}

export function rollOracle(tableId: string, ctx: OracleContext): OracleResult {
  return rollOracleRecord(tableId, ctx, 0);
}

function rollOracleRecord(tableId: string, ctx: OracleContext, depth: number): OracleRollRecord {
  if (depth > ORACLE_EXPAND_DEPTH_LIMIT) {
    throw new EngineFailure(
      'oracle_depth_exceeded',
      `oracle table expansion exceeded depth ${ORACLE_EXPAND_DEPTH_LIMIT} at "${tableId}"`,
    );
  }
  const rows = ctx.index.getOracleRows(tableId);
  if (!rows || rows.length === 0) {
    throw new EngineFailure(
      'unknown_table',
      `oracle table "${tableId}" not found`,
      'use the oracle catalog (listOracleTree) to find valid table ids',
    );
  }
  // Dice-aware rolling: a table whose rows cover 1-100 (declared 1d100, or the
  // synthetic 2d10 Ask-the-Oracle odds tables) uses the two-digit d100 with
  // match detection; anything else (declared 1d10 / 1d20) rolls one die sized
  // by the row coverage. Rolling d100 against a 1d10/1d20 table would leave
  // most of the range without a row.
  const sides = rows.reduce((max, row) => Math.max(max, row.max), 0);
  const { roll, dice, match } =
    sides === 100
      ? rollD100(ctx.rng)
      : { roll: rollDie(ctx.rng, sides), dice: undefined, match: false };
  const row = findRowByRoll(rows, roll);
  if (!row) {
    throw new EngineFailure(
      'unknown_table',
      `oracle table "${tableId}" has no row for roll ${roll}`,
    );
  }
  const nested: OracleRollRecord[] = [];
  const text = row.text.replace(TABLE_MARKER, (_full, ref: string) => {
    const child = rollOracleRecord(ref.trim(), ctx, depth + 1);
    nested.push(child);
    return child.text;
  });
  return {
    tableId,
    roll,
    dice,
    match,
    rowText: row.text,
    text,
    suggestion: row.suggestion?.text,
    nested,
  };
}

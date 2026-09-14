import { readFileSync } from 'node:fs';
import { loadStarforged } from '@starwright/data';
import type { EngineOutcome, ReduceResult } from './audit.js';

const raw: unknown = JSON.parse(
  readFileSync(new URL('../../../data/starforged.json', import.meta.url), 'utf8'),
);

const loaded = loadStarforged(raw);

export const realIndex = loaded.index;

export function outcomeOf<K extends EngineOutcome['kind']>(
  result: ReduceResult,
  kind: K,
): Extract<EngineOutcome, { kind: K }> {
  if (!result.ok) throw new Error(`expected ok outcome, got error: ${result.error.code}`);
  if (result.outcome.kind !== kind) {
    throw new Error(`expected outcome kind "${kind}", got "${result.outcome.kind}"`);
  }
  return result.outcome as Extract<EngineOutcome, { kind: K }>;
}

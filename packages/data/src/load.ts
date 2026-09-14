import { StarforgedSchema, EMPTY_DOMAINS } from './schema/index.js';
import { buildIndex, type BuiltIndex, type StarforgedIndex } from './indexer.js';

export interface LoadResult {
  index: StarforgedIndex;
  warnings: string[];
}

export function loadStarforged(raw: unknown): LoadResult {
  const data = StarforgedSchema.parse(raw);
  const warnings: string[] = [];
  const record = raw as Record<string, unknown>;
  for (const domain of EMPTY_DOMAINS) {
    const value = record[domain];
    const isEmpty =
      value == null ||
      (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
    if (isEmpty) {
      warnings.push(`skipped empty domain "${domain}"`);
    } else {
      warnings.push(`skipped unsupported domain "${domain}"`);
    }
  }
  const index: BuiltIndex = buildIndex(data);
  return { index, warnings };
}

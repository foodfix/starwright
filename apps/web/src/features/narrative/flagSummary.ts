import type { JsonValue } from '@starwright/engine';

/**
 * Models sometimes pass `set_flag` values as JSON-encoded strings instead of
 * real structures. Storage keeps the model's value verbatim; presentation
 * unwraps it so the settlement card reads as clean JSON.
 */
export function unwrapFlagValue(value: JsonValue): JsonValue {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed) as JsonValue;
      } catch {
        // not JSON after all — keep the original string
      }
    }
  }
  return value;
}

/** one-line summary for the collapsed settlement card */
export function flagSummary(value: JsonValue, max = 96): string {
  const unwrapped = unwrapFlagValue(value);
  const text = typeof unwrapped === 'string' ? unwrapped : JSON.stringify(unwrapped);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** full text for the expanded settlement card body */
export function flagDetail(value: JsonValue): string {
  const unwrapped = unwrapFlagValue(value);
  return typeof unwrapped === 'string' ? unwrapped : JSON.stringify(unwrapped, null, 2);
}

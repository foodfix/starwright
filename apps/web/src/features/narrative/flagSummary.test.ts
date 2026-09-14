import { describe, expect, it } from 'vitest';
import { flagDetail, flagSummary, unwrapFlagValue } from './flagSummary.js';

describe('flagSummary (settlement card presentation)', () => {
  it('unwraps JSON-encoded strings for display', () => {
    const stored = '{"sun_plague": "太阳瘟疫熄灭了故乡星系", "forge": "Exodus 舰队世代航行"}';
    const unwrapped = unwrapFlagValue(stored);
    expect(unwrapped).toEqual({
      sun_plague: '太阳瘟疫熄灭了故乡星系',
      forge: 'Exodus 舰队世代航行',
    });
    // no escaped quotes in the summary line
    expect(flagSummary(stored)).not.toContain('\\"');
    expect(flagSummary(stored)).toContain('太阳瘟疫熄灭了故乡星系');
  });

  it('unwraps JSON-encoded arrays and keeps plain strings verbatim', () => {
    expect(unwrapFlagValue('["a", "b"]')).toEqual(['a', 'b']);
    expect(unwrapFlagValue('The beacon is ours. For now.')).toBe('The beacon is ours. For now.');
    // broken JSON stays a string
    expect(unwrapFlagValue('{not json')).toBe('{not json');
  });

  it('passes non-string values through untouched', () => {
    expect(unwrapFlagValue(42)).toBe(42);
    expect(unwrapFlagValue(true)).toBe(true);
    expect(unwrapFlagValue({ a: 1 })).toEqual({ a: 1 });
    expect(unwrapFlagValue(null)).toBeNull();
  });

  it('truncates long summaries and pretty-prints details', () => {
    const long = { text: 'x'.repeat(200) };
    const summary = flagSummary(long);
    expect(summary.length).toBeLessThanOrEqual(97);
    expect(summary.endsWith('…')).toBe(true);
    expect(flagDetail(long)).toBe('{\n  "text": "' + 'x'.repeat(200) + '"\n}');
    expect(flagDetail('plain note')).toBe('plain note');
  });
});

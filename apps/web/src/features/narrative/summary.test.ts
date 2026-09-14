import { describe, expect, it } from 'vitest';
import { splitSummary } from './summary.js';

describe('splitSummary', () => {
  it('returns text unchanged without a block', () => {
    const out = splitSummary('Plain narration.');
    expect(out).toEqual({ body: 'Plain narration.', summary: '', present: false });
  });

  it('extracts and strips a complete block', () => {
    const text = 'The hunt ends.\n\n<summary>You tracked the raider and drove him off.</summary>';
    const out = splitSummary(text);
    expect(out.body).toBe('The hunt ends.');
    expect(out.summary).toBe('You tracked the raider and drove him off.');
    expect(out.present).toBe(true);
  });

  it('collapses whitespace inside the summary', () => {
    const out = splitSummary('<summary>A  quiet\n night   falls</summary>');
    expect(out.summary).toBe('A quiet night falls');
  });

  it('hides an unterminated block while streaming', () => {
    const out = splitSummary('Narration…\n\n<summary>Still writing');
    expect(out.body).toBe('Narration…');
    expect(out.summary).toBe('');
    expect(out.present).toBe(true);
  });

  it('ignores an empty block and keeps the text verbatim', () => {
    const text = 'Narration.\n<summary>   </summary>';
    const out = splitSummary(text);
    expect(out).toEqual({ body: text, summary: '', present: false });
  });

  it('strips stale earlier blocks and keeps only the latest', () => {
    const out = splitSummary('<summary>old</summary> mid <summary>new</summary> tail');
    expect(out.summary).toBe('new');
    expect(out.body).toBe('mid\n\ntail');
  });

  it('survives a summary block that sits before a choices block', () => {
    const text = [
      'Story so far.',
      '<summary>One-line recap.</summary>',
      '<choices>',
      '1. Act',
      '2. Wait',
      '</choices>',
    ].join('\n');
    const out = splitSummary(text);
    expect(out.summary).toBe('One-line recap.');
    expect(out.body).not.toContain('<summary>');
    expect(out.body).toContain('<choices>');
  });
});

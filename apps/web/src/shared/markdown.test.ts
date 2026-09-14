import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown.js';

describe('parseInline', () => {
  it('parses bold, italic, code and links', () => {
    expect(parseInline('**Bulwerk** hums, *dust* falls, `id-7`, [docs](https://x.y)')).toEqual([
      { kind: 'strong', text: 'Bulwerk' },
      { kind: 'text', text: ' hums, ' },
      { kind: 'em', text: 'dust' },
      { kind: 'text', text: ' falls, ' },
      { kind: 'code', text: 'id-7' },
      { kind: 'text', text: ', ' },
      { kind: 'link', text: 'docs', href: 'https://x.y' },
    ]);
  });

  it('supports __bold__ and keeps plain text', () => {
    expect(parseInline('__oath__ and plain')).toEqual([
      { kind: 'strong', text: 'oath' },
      { kind: 'text', text: ' and plain' },
    ]);
  });

  it('leaves non-http links as plain text', () => {
    const segments = parseInline('[Advance](id:starforged/moves/legacy/advance)');
    expect(segments).toEqual([
      { kind: 'text', text: '[Advance](id:starforged/moves/legacy/advance)' },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('splits paragraphs, lists, quotes and headings', () => {
    const blocks = parseMarkdown(
      'First paragraph.\nStill same one.\n\n## Title\n- one\n- two\n> quoted line\n\nTail.',
    );
    expect(blocks).toEqual([
      { type: 'p', text: 'First paragraph.\nStill same one.' },
      { type: 'h', level: 2, text: 'Title' },
      { type: 'ul', items: ['one', 'two'] },
      { type: 'quote', text: 'quoted line' },
      { type: 'p', text: 'Tail.' },
    ]);
  });

  it('merges consecutive bullets into one list', () => {
    const blocks = parseMarkdown('- a\n* b\n- c');
    expect(blocks).toEqual([{ type: 'ul', items: ['a', 'b', 'c'] }]);
  });
});

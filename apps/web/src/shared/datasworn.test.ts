import { describe, expect, it } from 'vitest';
import type { Move } from '@starwright/data';
import { dataswornToMarkdown, describeDataswornNodeMarkdown, parseDatasworn } from './datasworn.js';

describe('parseDatasworn', () => {
  it('parses bold and id-links, keeping plain text', () => {
    const segments = parseDatasworn(
      'When you [Advance](id:starforged/moves/legacy/advance), take __+1 momentum__ now.',
    );
    expect(segments).toEqual([
      { kind: 'text', text: 'When you ' },
      { kind: 'link', text: 'Advance', id: 'starforged/moves/legacy/advance' },
      { kind: 'text', text: ', take ' },
      { kind: 'strong', text: '+1 momentum' },
      { kind: 'text', text: ' now.' },
    ]);
  });

  it('handles multiple links and adjacent markers', () => {
    const segments = parseDatasworn('[A](id:x)[B](id:y)__C__');
    expect(segments).toEqual([
      { kind: 'link', text: 'A', id: 'x' },
      { kind: 'link', text: 'B', id: 'y' },
      { kind: 'strong', text: 'C' },
    ]);
  });

  it('returns plain text unchanged and handles empty input', () => {
    expect(parseDatasworn('no markers here')).toEqual([{ kind: 'text', text: 'no markers here' }]);
    expect(parseDatasworn('')).toEqual([]);
  });

  it('does not treat an unclosed marker as markup', () => {
    const segments = parseDatasworn('a __ b [c](id:');
    expect(segments).toEqual([{ kind: 'text', text: 'a __ b [c](id:' }]);
  });

  it('parses {{table:...}} oracle references, mixed with other markup', () => {
    const segments = parseDatasworn(
      'caused by:\n\n{{table:starforged/truths/cataclysm/0}} __or__ {{table:t1}}',
    );
    expect(segments).toEqual([
      { kind: 'text', text: 'caused by:\n\n' },
      { kind: 'table', text: '', id: 'starforged/truths/cataclysm/0' },
      { kind: 'text', text: ' ' },
      { kind: 'strong', text: 'or' },
      { kind: 'text', text: ' ' },
      { kind: 'table', text: '', id: 't1' },
    ]);
  });
});

describe('dataswornToMarkdown', () => {
  it('keeps bold markers and reduces id-links to their label', () => {
    expect(
      dataswornToMarkdown('__Bold__ and [Set a Flag](id:starforged/moves/session/set_a_flag).'),
    ).toBe('__Bold__ and Set a Flag.');
  });

  it('drops {{table:...}} placeholders and collapses blank lines, keeping list structure', () => {
    expect(dataswornToMarkdown('a\n\n{{table:t1}}\n\n  * item one\n  * item two')).toBe(
      'a\n\n  * item one\n  * item two',
    );
  });
});

describe('describeDataswornNodeMarkdown', () => {
  it('formats a move as bold name + markdown text with lists', () => {
    const move = {
      _id: 'starforged/moves/fate/pay_the_price',
      type: 'move',
      name: '付出代价',
      roll_type: 'no_roll',
      text: '__当你承受一项行动的后果时__，选择一项。\n\n  * 让负面结果发生。\n  * [询问神谕](id:starforged/moves/fate/ask_the_oracle)。\n\n{{table:starforged/oracles/moves/pay_the_price}}',
    } as Move;
    expect(describeDataswornNodeMarkdown(move)).toBe(
      '付出代价\n\n__当你承受一项行动的后果时__，选择一项。\n\n  * 让负面结果发生。\n  * 询问神谕。',
    );
  });

  it('prefers the first enabled asset ability', () => {
    const asset = {
      _id: 'starforged/asset/starship',
      type: 'asset' as const,
      name: 'Starship',
      category: 'command_vehicle',
      abilities: [
        { _id: 'a0', enabled: false, text: 'locked' },
        { _id: 'a1', enabled: true, text: 'Your [starship](id:x) has integrity 5.' },
      ],
    };
    expect(describeDataswornNodeMarkdown(asset)).toBe('Starship\n\nYour starship has integrity 5.');
  });

  it('uses your_character for truth nodes (no type field)', () => {
    const truth = {
      _id: 'starforged/truths/cataclysm',
      name: 'Cataclysm',
      options: [
        { min: 1, max: 10, summary: 'Devastating plague', description: 'd', quest_starter: 'q' },
      ],
      your_character: 'You survived __the worst__ of it.',
    };
    expect(describeDataswornNodeMarkdown(truth)).toBe(
      'Cataclysm\n\nYou survived __the worst__ of it.',
    );
  });

  it('falls back to the bare name when no summary field exists', () => {
    const oracle = {
      _id: 'starforged/oracles/x',
      type: 'oracle_rollable' as const,
      name: 'Ask the Oracle',
      oracle_type: 'yes/no',
      dice: '2d10',
      rows: [{ min: 1, max: 100, text: 'Yes' }],
    };
    expect(describeDataswornNodeMarkdown(oracle)).toBe('Ask the Oracle');
  });

  it('clips very long summaries', () => {
    const move = {
      _id: 'm',
      type: 'move',
      name: 'Long',
      roll_type: 'no_roll',
      text: 'x'.repeat(500),
    } as Move;
    const described = describeDataswornNodeMarkdown(move);
    expect(described.startsWith('Long\n\n')).toBe(true);
    expect(described.length).toBe('Long\n\n'.length + 400 + 1);
    expect(described.endsWith('…')).toBe(true);
  });
});

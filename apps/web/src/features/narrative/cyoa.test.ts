import { describe, expect, it } from 'vitest';
import { isStoryTag, latestChoices, resolveMove, resolveMoveName, splitChoices } from './cyoa.js';
import type { ChoicesSource, MoveCatalogSource } from './cyoa.js';

const BLOCK = [
  '<choices>',
  '1. Knock on the vault door [Face Danger]',
  '2. Pick the lock quietly [Secure an Advantage]',
  '3. Walk away [story]',
  '4. Ask the oracle [Ask the Oracle]',
  '5. Sing [story]',
  '</choices>',
].join('\n');

describe('splitChoices', () => {
  it('returns the text untouched when no block is present', () => {
    const text = 'The corridor hums. What do you do?';
    expect(splitChoices(text)).toEqual({ body: text, choices: [], present: false });
  });

  it('strips a complete block and extracts five options', () => {
    const text = `The door seals behind you.\n\n${BLOCK}`;
    const result = splitChoices(text);
    expect(result.present).toBe(true);
    expect(result.body).toBe('The door seals behind you.');
    expect(result.choices).toHaveLength(5);
    expect(result.choices[0]).toEqual({ text: 'Knock on the vault door', tag: 'Face Danger' });
    expect(result.choices[2]).toEqual({ text: 'Walk away', tag: 'story' });
    expect(result.choices[4]).toEqual({ text: 'Sing', tag: 'story' });
  });

  it('hides an unterminated block while streaming', () => {
    const text = `Suspense rises.\n\n<choices>\n1. Knock`;
    const result = splitChoices(text);
    expect(result.body).toBe('Suspense rises.');
    expect(result.choices).toEqual([]);
    expect(result.present).toBe(true);
  });

  it('keeps a complete but malformed block visible verbatim', () => {
    const text = ' narration <choices> free-form waffle without numbered lines </choices>';
    const result = splitChoices(text);
    expect(result.body).toBe(text);
    expect(result.choices).toEqual([]);
    expect(result.present).toBe(false);
  });

  it('parses CJK numbered lines and trailing prose after the block', () => {
    const text = `选择吧。\n\n<choices>\n1、敲响金库大门\n2）悄悄撬锁\n3. 离开\n</choices>\n\n（由 GM 提供）`;
    const result = splitChoices(text);
    expect(result.choices).toEqual([
      { text: '敲响金库大门' },
      { text: '悄悄撬锁' },
      { text: '离开' },
    ]);
    expect(result.body).toBe('选择吧。\n\n（由 GM 提供）');
  });

  it('uses the latest block when several appear', () => {
    const text = `<choices>\n1. old\n</choices>\n\n${BLOCK}`;
    const result = splitChoices(text);
    expect(result.choices).toHaveLength(5);
    expect(result.choices[0]).toEqual({ text: 'Knock on the vault door', tag: 'Face Danger' });
    expect(result.body).not.toContain('old');
  });

  describe('move tags', () => {
    it('extracts half-width move-name tags and story markers', () => {
      const text = '<choices>\n1. 冲进火场救人 [Face Danger]\n2. 原地休息 [剧情]\n</choices>';
      expect(splitChoices(text).choices).toEqual([
        { text: '冲进火场救人', tag: 'Face Danger' },
        { text: '原地休息', tag: '剧情' },
      ]);
    });

    it('accepts full-width bracket tags', () => {
      const text = '<choices>\n1. 撬开舱门【Compel】\n2. 沉默离开【剧情】\n</choices>';
      expect(splitChoices(text).choices).toEqual([
        { text: '撬开舱门', tag: 'Compel' },
        { text: '沉默离开', tag: '剧情' },
      ]);
    });

    it('keeps mid-line brackets in the option text', () => {
      const text = '<choices>\n1. 打开 [红色] 密封舱 [story]\n2. 直接离开 [剧情]\n</choices>';
      expect(splitChoices(text).choices).toEqual([
        { text: '打开 [红色] 密封舱', tag: 'story' },
        { text: '直接离开', tag: '剧情' },
      ]);
    });

    it('renders untagged options without a tag (graceful decay)', () => {
      const text = '<choices>\n1. Knock on the vault door\n2. Leave\n</choices>';
      expect(splitChoices(text).choices).toEqual([
        { text: 'Knock on the vault door' },
        { text: 'Leave' },
      ]);
    });
  });
});

describe('resolveMoveName / isStoryTag', () => {
  // zh data pack: names are translated, ids keep the English snake_case slug
  const zhIndex: MoveCatalogSource = {
    listMoves: () => [
      {
        name: 'Adventure Moves',
        moves: [
          { id: 'starforged/moves/adventure/face_danger', name: '直面危险' },
          { id: 'starforged/moves/adventure/compel', name: '劝服' },
        ],
      },
      {
        name: 'Scene Challenge Moves',
        moves: [
          { id: 'starforged/moves/scene_challenge/face_danger', name: '直面危险（场景挑战）' },
        ],
      },
    ],
  };

  it('resolves an English tag via the move id slug, first catalog match wins', () => {
    expect(resolveMoveName(zhIndex, 'Face Danger')).toBe('直面危险');
    expect(resolveMoveName(zhIndex, 'Compel')).toBe('劝服');
  });

  it('resolves the full catalog entry (id + localized name) for hover descriptions', () => {
    expect(resolveMove(zhIndex, 'Face Danger')).toEqual({
      id: 'starforged/moves/adventure/face_danger',
      name: '直面危险',
    });
    expect(resolveMove(zhIndex, 'Dance Wildly')).toBeUndefined();
  });

  it('matches a localized tag by exact name', () => {
    expect(resolveMoveName(zhIndex, '劝服')).toBe('劝服');
  });

  it('returns undefined for unknown tags', () => {
    expect(resolveMoveName(zhIndex, 'Dance Wildly')).toBeUndefined();
  });

  it('detects story markers in both narrative languages', () => {
    expect(isStoryTag('剧情')).toBe(true);
    expect(isStoryTag('story')).toBe(true);
    expect(isStoryTag('Face Danger')).toBe(false);
  });
});

describe('latestChoices', () => {
  const gmWithBlock: ChoicesSource = { kind: 'assistant', text: `Done.\n\n${BLOCK}` };

  it('finds choices when the GM message is the last entry', () => {
    expect(latestChoices([{ kind: 'user' }, gmWithBlock])).toHaveLength(5);
  });

  it('skips trailing mechanics strips and info notes after the GM message', () => {
    const entries: ChoicesSource[] = [
      { kind: 'user' },
      gmWithBlock,
      { kind: 'mechanics' },
      { kind: 'info', text: 'Turn stopped.' },
    ];
    expect(latestChoices(entries)).toHaveLength(5);
  });

  it('returns nothing once the player has replied after the GM message', () => {
    const entries: ChoicesSource[] = [gmWithBlock, { kind: 'mechanics' }, { kind: 'user' }];
    expect(latestChoices(entries)).toEqual([]);
  });

  it('returns nothing while the GM message is still streaming', () => {
    expect(
      latestChoices([{ kind: 'assistant', text: 'partial <choices>', streaming: true }]),
    ).toEqual([]);
  });

  it('returns nothing for non-GM trailers and empty input', () => {
    expect(latestChoices([{ kind: 'error', text: 'boom' }])).toEqual([]);
    expect(latestChoices([{ kind: 'user' }])).toEqual([]);
    expect(latestChoices([])).toEqual([]);
  });
});

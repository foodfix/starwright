import { describe, expect, it } from 'vitest';
import { createNewCampaign } from '@starwright/engine';
import {
  buildSnapshot,
  buildSystemPrompt,
  gmSpec,
  NARRATIVE_STYLES,
  type NarrativeStyle,
} from './prompt.js';
import { realIndex } from './test-support.js';

describe('buildSnapshot', () => {
  it('includes a non-empty character background as a canon line', () => {
    const state = createNewCampaign({
      characterName: 'Vagrant',
      stats: { edge: 3, heart: 2, iron: 2, shadow: 1, wits: 1 },
      background: 'Raised in the Terminus quarries.\nStole a ship and ran.',
    });
    const snapshot = buildSnapshot(state, realIndex);
    expect(snapshot).toContain(
      'BACKGROUND (player-written backstory — treat as canon): Raised in the Terminus quarries. Stole a ship and ran.',
    );
  });

  it('omits the background line when none was written', () => {
    const state = createNewCampaign({
      characterName: 'Vagrant',
      stats: { edge: 3, heart: 2, iron: 2, shadow: 1, wits: 1 },
    });
    expect(buildSnapshot(state, realIndex)).not.toContain('BACKGROUND');
  });

  it('includes the campaign truths as resident world-canon lines', () => {
    const state = createNewCampaign({
      characterName: 'Vagrant',
      stats: { edge: 3, heart: 2, iron: 2, shadow: 1, wits: 1 },
      truths: { cataclysm: '0' },
    });
    const snapshot = buildSnapshot(state, realIndex);
    expect(snapshot).toContain(
      'TRUTHS (world canon established at campaign start — treat as canon):',
    );
    expect(snapshot).toMatch(/- Cataclysm: .*Sun Plague/);
  });

  it('omits the TRUTHS section when no truths were chosen', () => {
    const state = createNewCampaign({
      characterName: 'Vagrant',
      stats: { edge: 3, heart: 2, iron: 2, shadow: 1, wits: 1 },
    });
    expect(buildSnapshot(state, realIndex)).not.toContain('TRUTHS');
  });
});

describe('CYOA prompt', () => {
  const state = createNewCampaign({
    characterName: 'Vagrant',
    stats: { edge: 3, heart: 2, iron: 2, shadow: 1, wits: 1 },
  });

  it('is absent by default and when explicitly disabled', () => {
    for (const prompt of [
      buildSystemPrompt(state, realIndex),
      buildSystemPrompt(state, realIndex, 'en', {}),
      buildSystemPrompt(state, realIndex, 'en', { cyoa: false }),
    ]) {
      expect(prompt).not.toContain('Player choices (CYOA)');
      expect(prompt).toContain('Turn recap');
      expect(prompt).toContain('<summary>');
      expect(prompt).toContain('then append the <summary> recap block');
    }
  });

  it('injects the choices-block instruction in both languages when enabled', () => {
    for (const language of ['en', 'zh'] as const) {
      const prompt = buildSystemPrompt(state, realIndex, language, { cyoa: true });
      expect(prompt).toContain('<choices>');
      expect(prompt).toContain('</choices>');
      expect(prompt).toContain(language === 'zh' ? '回合摘要' : 'Turn recap');
      expect(prompt).not.toContain('not a menu of options');
      expect(prompt).not.toContain('不要罗列选项菜单');
      // recap tail + recap rule line + choices format template
      expect(prompt.match(/<choices>/g)).toHaveLength(3);
    }
    expect(gmSpec('en', true)).toContain('Player choices (CYOA)');
    expect(gmSpec('zh', true)).toContain('玩家选项（CYOA）');
  });

  it('leaves the spec byte-identical to the legacy text when disabled', () => {
    expect(gmSpec('en')).toBe(gmSpec('en', false));
    expect(gmSpec('zh')).toBe(gmSpec('zh', false));
    expect(gmSpec('en', false)).not.toContain('CYOA');
    expect(gmSpec('zh', false)).not.toContain('CYOA');
  });

  it('requires pending "Choose one" outcomes to be surfaced with mechanical effects', () => {
    expect(gmSpec('en')).toContain('list each option with its mechanical effect spelled out');
    expect(gmSpec('en')).toContain('moving the scene forward');
    expect(gmSpec('zh')).toContain('写明各自的机械效果');
    expect(gmSpec('zh')).toContain('玩家未决前不得用工具落地，也不得推进剧情');
    for (const language of ['en', 'zh'] as const) {
      const prompt = buildSystemPrompt(state, realIndex, language, { cyoa: true });
      expect(prompt).toContain(
        language === 'zh' ? '写明机械效果' : 'mechanical effects spelled out',
      );
    }
  });

  it('requires a per-option move tag or story marker in both languages', () => {
    for (const language of ['en', 'zh'] as const) {
      const prompt = buildSystemPrompt(state, realIndex, language, { cyoa: true });
      expect(prompt).toContain(language === 'zh' ? '[Move 名]' : '[Move name]');
      expect(prompt).toContain(language === 'zh' ? '[剧情]' : '[story]');
      expect(prompt).toContain('[Face Danger]');
      expect(prompt).toContain(
        language === 'zh' ? '纯推进剧情、不涉机制的选项' : 'advances the fiction without mechanics',
      );
    }
  });
});

describe('narrative style presets', () => {
  const state = createNewCampaign({
    characterName: 'Vagrant',
    stats: { edge: 3, heart: 2, iron: 2, shadow: 1, wits: 1 },
  });

  it('defaults to the classic style (byte-identical to explicit classic)', () => {
    for (const language of ['en', 'zh'] as const) {
      expect(gmSpec(language, false)).toBe(gmSpec(language, false, 'classic'));
      expect(gmSpec(language, true)).toBe(gmSpec(language, true, 'classic'));
      expect(buildSystemPrompt(state, realIndex, language)).toBe(
        buildSystemPrompt(state, realIndex, language, { style: 'classic' }),
      );
    }
    expect(gmSpec('en')).toContain('2-4 tight paragraphs per turn');
    expect(gmSpec('zh')).toContain('每回合 2–4 段紧凑叙述');
  });

  it('injects each preset into the Style section in both languages', () => {
    const markers: Record<(typeof NARRATIVE_STYLES)[number], [string, string]> = {
      classic: ['2-4 tight paragraphs per turn', '每回合 2–4 段紧凑叙述'],
      concise: ['1-2 short paragraphs per turn', '每回合 1–2 短段叙述'],
      literary: ['3-5 paragraphs per turn', '每回合 3–5 段叙述'],
      humorous: ['playful, witty voice', '笔调轻松诙谐'],
      hardboiled: ['gritty hardboiled voice', '冷硬派笔调'],
    };
    for (const style of NARRATIVE_STYLES) {
      expect(gmSpec('en', false, style)).toContain(markers[style][0]);
      expect(gmSpec('zh', false, style)).toContain(markers[style][1]);
      expect(buildSystemPrompt(state, realIndex, 'en', { style })).toContain(markers[style][0]);
    }
  });

  it('keeps the shared style invariants for every preset', () => {
    for (const style of NARRATIVE_STYLES) {
      for (const language of ['en', 'zh'] as const) {
        const spec = gmSpec(language, true, style);
        expect(spec).not.toMatch(/\{STYLE_PARAGRAPH\}/);
        if (language === 'en') {
          expect(spec).toMatch(/second person for the player/i);
          expect(spec).toContain('End turns with a hook or clear situation');
        } else {
          expect(spec).toContain('对玩家使用第二人称');
          expect(spec).toContain('回合结尾给出悬念或明确处境');
        }
      }
    }
  });

  it('falls back to classic for unknown style values', () => {
    expect(gmSpec('en', false, 'noir' as NarrativeStyle)).toBe(gmSpec('en', false, 'classic'));
    expect(gmSpec('zh', true, 'noir' as NarrativeStyle)).toBe(gmSpec('zh', true, 'classic'));
  });

  it('injects the custom style text when style is custom', () => {
    const text = '每回合一段，散文诗笔调，多用比喻。';
    for (const language of ['en', 'zh'] as const) {
      const spec = gmSpec(language, true, 'custom', text);
      expect(spec).toContain(text);
      expect(
        buildSystemPrompt(state, realIndex, language, { style: 'custom', customStyle: text }),
      ).toContain(text);
    }
    expect(gmSpec('en', false, 'custom', '1-2 paragraphs, noir prose, second person')).toContain(
      '1-2 paragraphs, noir prose, second person',
    );
  });

  it('normalizes custom style whitespace and caps its length', () => {
    expect(gmSpec('en', false, 'custom', 'terse  \n and\tgritty')).toContain('terse and gritty');
    const long = `x`.repeat(700);
    const spec = gmSpec('en', false, 'custom', long);
    expect(spec).not.toContain(`x`.repeat(601));
    expect(spec).toContain(`x`.repeat(600));
  });

  it('falls back to classic when the custom style text is blank or missing', () => {
    for (const text of ['', '   \n\t ']) {
      expect(gmSpec('en', false, 'custom', text)).toBe(gmSpec('en', false, 'classic'));
      expect(gmSpec('zh', true, 'custom', text)).toBe(gmSpec('zh', true, 'classic'));
    }
    expect(gmSpec('en', false, 'custom')).toBe(gmSpec('en', false, 'classic'));
    expect(buildSystemPrompt(state, realIndex, 'en', { style: 'custom' })).toBe(
      buildSystemPrompt(state, realIndex, 'en', { style: 'classic' }),
    );
  });
});

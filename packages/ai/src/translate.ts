import { LlmError, completeOnce } from './client.js';
import type { FetchImpl, LlmConfig } from './types.js';

export type TranslateTargetLang = 'zh' | 'en';

const LANG_NAMES: Record<TranslateTargetLang, string> = {
  zh: 'Simplified Chinese (简体中文)',
  en: 'English',
};

function buildMessages(
  text: string,
  targetLang: TranslateTargetLang,
): Array<{
  role: 'system' | 'user';
  content: string;
}> {
  return [
    {
      role: 'system',
      content:
        'You translate game rule text for the Ironsworn: Starforged RPG. ' +
        'Translate faithfully and concisely. Preserve inline markup verbatim: ' +
        '__bold__ markers, [label](id:...) links and {{table:...}} templates must survive unchanged. ' +
        'Return ONLY the translated text, with no notes or explanations.',
    },
    {
      role: 'user',
      content: `Translate into ${LANG_NAMES[targetLang] ?? targetLang}:\n\n${text}`,
    },
  ];
}

/**
 * Translate a Datasworn text snippet via the configured LLM (non-streaming).
 * Pure transport: caching is the caller's concern.
 */
export async function translateText(
  config: LlmConfig,
  text: string,
  targetLang: TranslateTargetLang,
  opts: { fetchImpl?: FetchImpl; signal?: AbortSignal; maxTokens?: number } = {},
): Promise<string> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return text;
  const out = (await completeOnce(config, buildMessages(trimmed, targetLang), opts)).trim();
  if (out.length === 0) {
    throw new LlmError({
      code: 'malformed_response',
      message: 'Translation returned empty content',
    });
  }
  return out;
}

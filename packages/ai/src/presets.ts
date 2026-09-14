import type { LlmConfig } from './types.js';

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function chatCompletionsUrl(config: LlmConfig): string {
  const base = normalizeBaseUrl(config.baseUrl);
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

import { describe, expect, it } from 'vitest';
import { completeOnce } from './client.js';
import { translateText } from './translate.js';
import type { FetchImpl } from './types.js';
import { jsonResponse } from './test-support.js';

const CONFIG = {
  baseUrl: 'https://llm.example.com/v1/',
  apiKey: 'sk-test',
  model: 'test-model',
};

function textResponse(text: string): Response {
  return jsonResponse({ choices: [{ message: { content: text } }] });
}

describe('completeOnce', () => {
  it('posts a non-streaming request without tools and returns content', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl: FetchImpl = (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(textResponse('  pong  '));
    };
    const out = await completeOnce(CONFIG, [{ role: 'user', content: 'ping' }], { fetchImpl });
    expect(out).toBe('  pong  ');
    const body = bodies[0] ?? {};
    expect(body['stream']).toBe(false);
    expect(body['tools']).toBeUndefined();
    expect(body['model']).toBe('test-model');
  });

  it('surfaces HTTP diagnostics from the provider', async () => {
    const fetchImpl: FetchImpl = () =>
      Promise.resolve(jsonResponse({ error: { message: 'nope' } }, 401));
    await expect(
      completeOnce(CONFIG, [{ role: 'user', content: 'ping' }], { fetchImpl }),
    ).rejects.toMatchObject({ diagnostic: { code: 'auth_failed' } });
  });
});

describe('translateText', () => {
  it('sends the source text and returns the trimmed translation', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl: FetchImpl = (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(textResponse('强命中'));
    };
    const out = await translateText(CONFIG, 'Strong hit', 'zh', { fetchImpl });
    expect(out).toBe('强命中');
    const messages = (bodies[0]?.['messages'] ?? []) as Array<{ content: string }>;
    expect(messages.some((m) => m.content.includes('Strong hit'))).toBe(true);
    expect(messages.some((m) => m.content.includes('简体中文'))).toBe(true);
  });

  it('passes whitespace-only input through without a network call', async () => {
    let called = 0;
    const fetchImpl: FetchImpl = () => {
      called += 1;
      return Promise.resolve(textResponse('x'));
    };
    const out = await translateText(CONFIG, '   ', 'zh', { fetchImpl });
    expect(out).toBe('   ');
    expect(called).toBe(0);
  });

  it('rejects empty completions as malformed responses', async () => {
    const fetchImpl: FetchImpl = () => Promise.resolve(textResponse('   '));
    await expect(translateText(CONFIG, 'Strong hit', 'en', { fetchImpl })).rejects.toMatchObject({
      diagnostic: { code: 'malformed_response' },
    });
  });
});

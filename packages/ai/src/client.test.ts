import { describe, expect, it, vi } from 'vitest';
import { LlmError, streamChat, testConnection } from './client.js';
import type { FetchImpl } from './types.js';
import {
  contentFrames,
  doneFrame,
  frame,
  jsonResponse,
  sseResponse,
  toolCallFrames,
  usageFrame,
  type ScriptedToolCall,
} from './test-support.js';

const CONFIG = {
  baseUrl: 'https://llm.example.com/v1/',
  apiKey: 'sk-test',
  model: 'test-model',
};

const MESSAGES = [
  { role: 'system' as const, content: 'sys' },
  { role: 'user' as const, content: 'hello' },
];

function scriptedFetch(script: Array<(input: string, init?: RequestInit) => Response>): {
  fetchImpl: FetchImpl;
  bodies: Array<Record<string, unknown>>;
} {
  const bodies: Array<Record<string, unknown>> = [];
  let index = 0;
  const fetchImpl: FetchImpl = (input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    if (!step) throw new Error('script exhausted');
    return Promise.resolve(step(input, init));
  };
  return { fetchImpl, bodies };
}

function streamOk(text: string, toolCalls: ScriptedToolCall[] = [], usage = true): Response {
  const frames = [...contentFrames(text), ...toolCallFrames(toolCalls)];
  if (usage) frames.push(usageFrame(11, 7));
  frames.push(doneFrame);
  return sseResponse(frames);
}

describe('streamChat', () => {
  it('posts to baseUrl+/chat/completions with auth header and streaming options', async () => {
    const { fetchImpl, bodies } = scriptedFetch([() => streamOk('ok')]);
    const result = await streamChat({ config: CONFIG, messages: MESSAGES, fetchImpl });
    expect(result.content).toBe('ok');
    const body = bodies[0];
    expect(body).toMatchObject({
      model: 'test-model',
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(body?.['messages']).toEqual(MESSAGES);
  });

  it('sends Authorization only when a key is configured', async () => {
    let auth: string | undefined;
    const fetchImpl: FetchImpl = (_input, init) => {
      auth = new Headers(init?.headers).get('Authorization') ?? undefined;
      return Promise.resolve(streamOk('x'));
    };
    await streamChat({ config: { ...CONFIG, apiKey: '' }, messages: MESSAGES, fetchImpl });
    expect(auth).toBeUndefined();
    await streamChat({ config: CONFIG, messages: MESSAGES, fetchImpl });
    expect(auth).toBe('Bearer sk-test');
  });

  it('emits incremental text deltas', async () => {
    const deltas: string[] = [];
    const { fetchImpl } = scriptedFetch([() => streamOk('one two three')]);
    await streamChat({
      config: CONFIG,
      messages: MESSAGES,
      fetchImpl,
      onTextDelta: (t) => deltas.push(t),
    });
    expect(deltas.join('')).toBe('one two three');
    expect(deltas.length).toBeGreaterThan(1);
  });

  it('emits reasoning deltas and returns the aggregated reasoning', async () => {
    const deltas: string[] = [];
    const { fetchImpl } = scriptedFetch([
      () =>
        sseResponse([
          frame({ choices: [{ delta: { reasoning_content: 'pondering… ' } }] }),
          ...contentFrames('ok'),
          doneFrame,
        ]),
    ]);
    const result = await streamChat({
      config: CONFIG,
      messages: MESSAGES,
      fetchImpl,
      onReasoningDelta: (t) => deltas.push(t),
    });
    expect(deltas.join('')).toBe('pondering… ');
    expect(result.reasoning).toBe('pondering… ');
    expect(result.content).toBe('ok');
  });

  it('parses reasoning from a non-streaming response', async () => {
    const { fetchImpl } = scriptedFetch([
      () =>
        jsonResponse({
          choices: [
            { message: { content: 'ok', reasoning_content: 'why' }, finish_reason: 'stop' },
          ],
        }),
    ]);
    const result = await streamChat({
      config: CONFIG,
      messages: MESSAGES,
      fetchImpl,
      stream: false,
    });
    expect(result.reasoning).toBe('why');
  });

  it('aggregates streamed tool calls', async () => {
    const { fetchImpl } = scriptedFetch([
      () =>
        streamOk('', [
          {
            id: 'call_1',
            name: 'roll_oracle',
            arguments: '{"table_id":"starforged/oracles/core/action"}',
          },
        ]),
    ]);
    const result = await streamChat({ config: CONFIG, messages: MESSAGES, fetchImpl });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.function.name).toBe('roll_oracle');
    expect(result.finishReason).toBe('tool_calls');
    expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 7 });
  });

  it('omits tools when none are provided (wrap-up request)', async () => {
    const { fetchImpl, bodies } = scriptedFetch([() => streamOk('done')]);
    await streamChat({ config: CONFIG, messages: MESSAGES, fetchImpl });
    expect(bodies[0]).not.toHaveProperty('tools');
  });

  it('maps HTTP errors to diagnostics', async () => {
    const cases: Array<[number, string]> = [
      [401, 'auth_failed'],
      [403, 'auth_failed'],
      [404, 'not_found'],
      [429, 'rate_limited'],
      [500, 'http_error'],
    ];
    for (const [status, code] of cases) {
      const { fetchImpl } = scriptedFetch([
        () => jsonResponse({ error: { message: 'nope' } }, status),
      ]);
      const error = await streamChat({ config: CONFIG, messages: MESSAGES, fetchImpl }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).diagnostic.code).toBe(code);
      expect((error as LlmError).diagnostic.status).toBe(status);
    }
  });

  it('maps fetch rejection to network_error', async () => {
    const fetchImpl: FetchImpl = () => Promise.reject(new TypeError('fetch failed'));
    const error = await streamChat({ config: CONFIG, messages: MESSAGES, fetchImpl }).catch(
      (e: unknown) => e,
    );
    expect((error as LlmError).diagnostic.code).toBe('network_error');
  });

  it('maps abort to aborted', async () => {
    const controller = new AbortController();
    const fetchImpl: FetchImpl = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const promise = streamChat({
      config: CONFIG,
      messages: MESSAGES,
      fetchImpl,
      signal: controller.signal,
    });
    controller.abort();
    const error = await promise.catch((e: unknown) => e);
    expect((error as LlmError).diagnostic.code).toBe('aborted');
  });

  it('rejects an empty stream as malformed', async () => {
    const { fetchImpl } = scriptedFetch([() => sseResponse([doneFrame])]);
    const error = await streamChat({ config: CONFIG, messages: MESSAGES, fetchImpl }).catch(
      (e: unknown) => e,
    );
    expect((error as LlmError).diagnostic.code).toBe('malformed_response');
  });

  it('accepts a non-streaming shaped payload inside a stream', async () => {
    const { fetchImpl } = scriptedFetch([
      () =>
        sseResponse([
          frame({
            choices: [
              { message: { content: 'flat response', tool_calls: [] }, finish_reason: 'stop' },
            ],
          }),
          doneFrame,
        ]),
    ]);
    const result = await streamChat({ config: CONFIG, messages: MESSAGES, fetchImpl });
    expect(result.content).toBe('flat response');
    expect(result.finishReason).toBe('stop');
  });
});

describe('testConnection', () => {
  it('passes when the model returns the probe tool call', async () => {
    const { fetchImpl, bodies } = scriptedFetch([
      () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 't1',
                    type: 'function',
                    function: { name: 'report_ready', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
    ]);
    const result = await testConnection(CONFIG, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(bodies[0]).toMatchObject({
      stream: false,
      tool_choice: { type: 'function', function: { name: 'report_ready' } },
    });
  });

  it('degrades tool_choice to required, then auto, when forced mode is rejected', async () => {
    const badRequest = () =>
      jsonResponse(
        { error: { message: "Invalid parameter: tool_choice must be one of 'none', 'auto'" } },
        400,
      );
    const { fetchImpl, bodies } = scriptedFetch([
      badRequest,
      badRequest,
      () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 't2',
                    type: 'function',
                    function: { name: 'report_ready', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        }),
    ]);
    const result = await testConnection(CONFIG, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(bodies[1]?.['tool_choice']).toBe('required');
    expect(bodies[2]?.['tool_choice']).toBe('auto');
  });

  it('reports no_function_calling when auto mode yields no tool call', async () => {
    const badRequest = () => jsonResponse({ error: { message: 'tool_choice unsupported' } }, 400);
    const { fetchImpl } = scriptedFetch([
      badRequest,
      badRequest,
      () => jsonResponse({ choices: [{ message: { content: 'I am ready' } }] }),
    ]);
    const result = await testConnection(CONFIG, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.diagnostic?.code).toBe('no_function_calling');
  });

  it('fails fast on auth errors without retrying', async () => {
    const fetchMock = vi.fn<FetchImpl>(() =>
      Promise.resolve(jsonResponse({ error: { message: 'bad key' } }, 401)),
    );
    const result = await testConnection(CONFIG, { fetchImpl: fetchMock });
    expect(result.ok).toBe(false);
    expect(result.diagnostic?.code).toBe('auth_failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

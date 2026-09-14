import { SseParser } from './sse.js';
import { chatCompletionsUrl } from './presets.js';
import type {
  ConnectionTestResult,
  FetchImpl,
  LlmConfig,
  LlmDiagnostic,
  StreamChatOptions,
  StreamResult,
  ToolSpec,
} from './types.js';

export class LlmError extends Error {
  readonly diagnostic: LlmDiagnostic;

  constructor(diagnostic: LlmDiagnostic) {
    super(diagnostic.message);
    this.name = 'LlmError';
    this.diagnostic = diagnostic;
  }
}

export function defaultFetchImpl(): FetchImpl {
  return (input, init) => fetch(input, init);
}

function toDiagnostic(e: unknown): LlmDiagnostic {
  if (e instanceof LlmError) return e.diagnostic;
  if (e instanceof DOMException && e.name === 'AbortError') {
    return { code: 'aborted', message: 'Request aborted' };
  }
  if (e instanceof Error && e.name === 'AbortError') {
    return { code: 'aborted', message: 'Request aborted' };
  }
  return {
    code: 'network_error',
    message: e instanceof Error ? e.message : String(e),
  };
}

async function diagnoseHttpError(res: Response): Promise<LlmError> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    detail = '';
  }
  const base = `HTTP ${res.status}${detail ? `: ${detail}` : ''}`;
  if (res.status === 401 || res.status === 403) {
    return new LlmError({
      code: 'auth_failed',
      message: `API key rejected — ${base}`,
      status: res.status,
    });
  }
  if (res.status === 404) {
    return new LlmError({
      code: 'not_found',
      message: `Endpoint or model not found — ${base}`,
      status: res.status,
    });
  }
  if (res.status === 429) {
    return new LlmError({
      code: 'rate_limited',
      message: `Rate limited or quota exceeded — ${base}`,
      status: res.status,
    });
  }
  return new LlmError({ code: 'http_error', message: base, status: res.status });
}

interface RequestBody {
  model: string;
  messages: unknown[];
  stream: boolean;
  stream_options?: { include_usage: boolean };
  tools?: readonly ToolSpec[];
  tool_choice?: unknown;
  max_tokens?: number;
}

function buildHeaders(config: LlmConfig): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey.trim().length > 0) headers['Authorization'] = `Bearer ${config.apiKey.trim()}`;
  return headers;
}

export async function streamChat(options: StreamChatOptions): Promise<StreamResult> {
  const { config, messages, tools, signal } = options;
  const fetchImpl = options.fetchImpl ?? defaultFetchImpl();
  const stream = options.stream !== false;
  const body: RequestBody = {
    model: config.model,
    messages,
    stream,
  };
  if (stream) body.stream_options = { include_usage: true };
  if (tools && tools.length > 0) body.tools = tools;

  let res: Response;
  try {
    res = await fetchImpl(chatCompletionsUrl(config), {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
      signal,
    });
  } catch (e: unknown) {
    throw new LlmError(toDiagnostic(e));
  }
  if (!res.ok) throw await diagnoseHttpError(res);

  if (!stream) {
    return parseNonStreamingResponse(await res.json());
  }
  if (!res.body) {
    throw new LlmError({ code: 'malformed_response', message: 'Response has no body stream' });
  }

  const parser = new SseParser();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const before = parser.aggregation.content.length;
      const beforeReasoning = parser.aggregation.reasoning.length;
      parser.feed(decoder.decode(value, { stream: true }));
      const delta = parser.aggregation.content.slice(before);
      if (delta.length > 0) options.onTextDelta?.(delta);
      const reasoningDelta = parser.aggregation.reasoning.slice(beforeReasoning);
      if (reasoningDelta.length > 0) options.onReasoningDelta?.(reasoningDelta);
      if (parser.done) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    parser.feed(decoder.decode());
  } catch (e: unknown) {
    throw new LlmError(toDiagnostic(e));
  }
  const aggregation = parser.aggregation;
  if (
    aggregation.content.length === 0 &&
    aggregation.toolCalls.size === 0 &&
    aggregation.finishReason === null
  ) {
    throw new LlmError({
      code: 'malformed_response',
      message: 'Stream ended without any content or tool calls',
    });
  }
  return {
    content: aggregation.content,
    reasoning: aggregation.reasoning,
    toolCalls: [...aggregation.toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call),
    finishReason: aggregation.finishReason,
    usage: aggregation.usage,
  };
}

interface NonStreamingResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

function parseNonStreamingResponse(payload: unknown): StreamResult {
  const data = payload as NonStreamingResponse;
  const choice = data.choices?.[0];
  if (!choice) {
    throw new LlmError({
      code: 'malformed_response',
      message: 'Response contains no choices',
    });
  }
  return {
    content: choice.message?.content ?? '',
    reasoning: choice.message?.reasoning_content ?? choice.message?.reasoning ?? '',
    toolCalls: (choice.message?.tool_calls ?? []).map((call, index) => ({
      id: call.id ?? `call_${index}`,
      type: 'function',
      function: { name: call.function?.name ?? '', arguments: call.function?.arguments ?? '' },
    })),
    finishReason: choice.finish_reason ?? null,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * One-shot non-streaming completion (no tools): the smallest useful primitive
 * for auxiliary LLM calls such as translating game text.
 */
export async function completeOnce(
  config: LlmConfig,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: { fetchImpl?: FetchImpl; signal?: AbortSignal; maxTokens?: number } = {},
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? defaultFetchImpl();
  const body: RequestBody = {
    model: config.model,
    messages,
    stream: false,
    max_tokens: opts.maxTokens ?? 1024,
  };
  let res: Response;
  try {
    res = await fetchImpl(chatCompletionsUrl(config), {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e: unknown) {
    throw new LlmError(toDiagnostic(e));
  }
  if (!res.ok) throw await diagnoseHttpError(res);
  return parseNonStreamingResponse(await res.json()).content;
}

const PROBE_TOOL: ToolSpec = {
  type: 'function',
  function: {
    name: 'report_ready',
    description:
      'Call this function immediately to confirm that function calling works. Takes no arguments.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
};

type ToolChoiceStep = { mode: 'named' | 'required' | 'auto'; body: unknown };

function toolChoiceSteps(): ToolChoiceStep[] {
  return [
    {
      mode: 'named',
      body: { type: 'function', function: { name: PROBE_TOOL.function.name } },
    },
    { mode: 'required', body: 'required' },
    { mode: 'auto', body: 'auto' },
  ];
}

function isToolChoiceRejection(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes('tool_choice') ||
    lowered.includes('tool choice') ||
    lowered.includes("must be one of 'none', 'auto'") ||
    (lowered.includes('function') && lowered.includes('invalid'))
  );
}

/**
 * Connection test: a tiny non-streaming completion that forces a function call.
 * Verifies the model supports tool calling; degrades tool_choice when the
 * gateway rejects forced modes. `auto` still requires the model to produce a
 * tool call (the probe instructs it to).
 */
export async function testConnection(
  config: LlmConfig,
  opts: { fetchImpl?: FetchImpl; signal?: AbortSignal } = {},
): Promise<ConnectionTestResult> {
  const started = Date.now();
  const messages = [
    {
      role: 'system' as const,
      content: 'You are a connectivity probe. Call the report_ready function now.',
    },
    { role: 'user' as const, content: 'ping' },
  ];
  let lastDiagnostic: LlmDiagnostic | undefined;
  for (const step of toolChoiceSteps()) {
    try {
      const payload = await requestProbe(config, messages, step.body, opts);
      const parsed = parseNonStreamingResponse(payload);
      const ok = parsed.toolCalls.some((call) => call.function.name === PROBE_TOOL.function.name);
      if (!ok && step.mode === 'auto') {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          model: config.model,
          diagnostic: {
            code: 'no_function_calling',
            message: 'Model did not return a tool call (function calling unsupported?)',
          },
        };
      }
      return { ok, latencyMs: Date.now() - started, model: config.model };
    } catch (e: unknown) {
      const diagnostic = toDiagnostic(e);
      lastDiagnostic = diagnostic;
      const retryable =
        diagnostic.code === 'http_error' &&
        diagnostic.status === 400 &&
        isToolChoiceRejection(diagnostic.message) &&
        step.mode !== 'auto';
      if (!retryable) {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          model: config.model,
          diagnostic,
        };
      }
    }
  }
  return {
    ok: false,
    latencyMs: Date.now() - started,
    model: config.model,
    diagnostic: lastDiagnostic ?? { code: 'http_error', message: 'Connection test failed' },
  };
}

async function requestProbe(
  config: LlmConfig,
  messages: unknown,
  toolChoice: unknown,
  opts: { fetchImpl?: FetchImpl; signal?: AbortSignal },
): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? defaultFetchImpl();
  const body: RequestBody = {
    model: config.model,
    messages: messages as [],
    stream: false,
    tools: [PROBE_TOOL],
    tool_choice: toolChoice,
    max_tokens: 512,
  };
  let res: Response;
  try {
    res = await fetchImpl(chatCompletionsUrl(config), {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e: unknown) {
    throw new LlmError(toDiagnostic(e));
  }
  if (!res.ok) throw await diagnoseHttpError(res);
  return res.json();
}

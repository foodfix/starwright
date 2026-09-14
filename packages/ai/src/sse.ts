import type { ToolCallRequest } from './types.js';

export interface SseAggregation {
  content: string;
  /** reasoning_content / reasoning deltas concatenated (pass-through only) */
  reasoning: string;
  toolCalls: Map<number, ToolCallRequest>;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number };
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      role?: string;
      content?: string | null;
      /** GLM/DeepSeek style reasoning field */
      reasoning_content?: string | null;
      /** OpenRouter style reasoning field */
      reasoning?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: ToolCallRequest[];
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

function emptyAggregation(): SseAggregation {
  return {
    content: '',
    reasoning: '',
    toolCalls: new Map(),
    finishReason: null,
    usage: { promptTokens: 0, completionTokens: 0 },
  };
}

/**
 * Incremental SSE parser for OpenAI-compatible `chat/completions` streams.
 * Feed arbitrary text fragments; complete `data:` frames are parsed as they
 * arrive (handles frames split across chunk boundaries via buffering).
 */
export class SseParser {
  private buffer = '';
  readonly aggregation: SseAggregation = emptyAggregation();
  done = false;
  /** non-streaming shaped payload observed inside a data frame (some gateways) */
  private sawNonStreamShape = false;

  feed(text: string): void {
    if (this.done) return;
    this.buffer += text;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      this.handleLine(line);
      if (this.done) return;
      newline = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    if (line.length === 0 || line.startsWith(':')) return;
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') {
      this.done = true;
      return;
    }
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(payload) as StreamChunk;
    } catch {
      return;
    }
    this.handleChunk(chunk);
  }

  private handleChunk(chunk: StreamChunk): void {
    if (chunk.usage) {
      // OpenAI-style providers emit usage once (final chunk); last value wins
      this.aggregation.usage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
      };
    }
    for (const choice of chunk.choices ?? []) {
      if (choice.finish_reason) this.aggregation.finishReason = choice.finish_reason;
      const delta = choice.delta;
      if (delta) {
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          this.aggregation.content += delta.content;
        }
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          this.aggregation.reasoning += reasoning;
        }
        for (const call of delta.tool_calls ?? []) {
          this.mergeToolCall(call);
        }
      }
      const message = choice.message;
      if (message) {
        if (typeof message.content === 'string' && message.content.length > 0) {
          this.aggregation.content += message.content;
        }
        const reasoning = message.reasoning_content ?? message.reasoning;
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          this.aggregation.reasoning += reasoning;
        }
        for (const call of message.tool_calls ?? []) {
          this.mergeToolCall({
            index: this.aggregation.toolCalls.size,
            id: call.id,
            type: call.type,
            function: call.function,
          });
        }
        if (
          message.tool_calls?.length ||
          message.content ||
          message.reasoning_content ||
          message.reasoning
        )
          this.sawNonStreamShape = true;
      }
    }
  }

  private mergeToolCall(call: {
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }): void {
    const index = call.index ?? this.aggregation.toolCalls.size;
    const existing = this.aggregation.toolCalls.get(index);
    if (!existing) {
      this.aggregation.toolCalls.set(index, {
        id: call.id ?? `call_${index}`,
        type: 'function',
        function: {
          name: call.function?.name ?? '',
          arguments: call.function?.arguments ?? '',
        },
      });
      return;
    }
    if (call.id) existing.id = call.id;
    if (call.function?.name) existing.function.name += call.function.name;
    if (call.function?.arguments) existing.function.arguments += call.function.arguments;
  }

  /** true when a chunk carried a non-streaming message shape */
  get nonStreamShape(): boolean {
    return this.sawNonStreamShape;
  }
}

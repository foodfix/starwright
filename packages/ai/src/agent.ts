import {
  executeToolCall,
  toolResultContent,
  type ExecutorContext,
  type ToolExecution,
} from './executor.js';
import { buildSystemPrompt, type NarrativeLanguage, type NarrativeStyle } from './prompt.js';
import { LlmError, streamChat } from './client.js';
import type {
  ChatMessage,
  ChatUsage,
  FetchImpl,
  LlmConfig,
  LlmDiagnostic,
  StreamResult,
  ToolCallRequest,
  ToolSpec,
} from './types.js';
import { TOOL_SPECS } from './tools.js';

export const DEFAULT_TOOL_BUDGET = 12;
const DEFAULT_MAX_HISTORY = 40;

export interface TurnToolRecord {
  seq: number;
  name: string;
  args: unknown;
  execution: ToolExecution;
  /** exact content sent back to the model as the tool result */
  content: string;
}

/** audit record of one request/response exchange within a turn */
export interface TurnInteraction {
  /** 0-based round within the turn */
  round: number;
  /** exact messages sent in this request (snapshot taken before the call) */
  messages: ChatMessage[];
  /** tool schemas offered in this request; absent on budget wrap-up requests */
  tools?: readonly ToolSpec[];
  /** narrative text returned by the model */
  content: string;
  /** reasoning_content / reasoning returned by the model (empty if none) */
  reasoning: string;
  /** tool calls the model requested in this round */
  toolCalls: ToolCallRequest[];
  finishReason: string | null;
  /** diagnostic when this request failed */
  error?: LlmDiagnostic;
}

export interface TurnRequestInfo {
  round: number;
  /** exact messages sent in this request (snapshot taken before the call) */
  messages: ChatMessage[];
  /** tool schemas offered in this request; absent on budget wrap-up requests */
  tools?: readonly ToolSpec[];
}

export interface RunTurnParams {
  config: LlmConfig;
  /** rolling conversation history without the system message */
  history: ChatMessage[];
  userInput: string;
  executor: ExecutorContext;
  language: NarrativeLanguage;
  /** CYOA: instruct the model to close each turn with a 5-option <choices> block */
  cyoa?: boolean;
  /** narrative style preset injected into the GM spec "Style" section (default classic) */
  style?: NarrativeStyle;
  /** player-written style text, injected when style is 'custom' (falls back to classic when blank) */
  customStyle?: string;
  toolBudget?: number;
  maxHistoryMessages?: number;
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
  onTextDelta?: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  /** fired before each request with the exact messages/tools about to be sent */
  onRequest?: (request: TurnRequestInfo) => void;
  onToolCall?: (call: { seq: number; name: string; args: unknown }) => void;
  onToolResult?: (record: TurnToolRecord) => void;
}

export interface TurnResult {
  /** updated history (still without the system message) for the next turn */
  messages: ChatMessage[];
  toolCalls: TurnToolRecord[];
  usage: ChatUsage;
  truncatedByBudget: boolean;
  /** per-request audit records, in request order */
  interactions: TurnInteraction[];
  error?: LlmDiagnostic;
}

function emptyUsage(): ChatUsage {
  return { promptTokens: 0, completionTokens: 0 };
}

function addUsage(total: ChatUsage, usage: ChatUsage): void {
  total.promptTokens += usage.promptTokens;
  total.completionTokens += usage.completionTokens;
}

function budgetNotice(language: NarrativeLanguage): string {
  return language === 'zh'
    ? '本回合工具预算已用尽：不要再调用任何工具。用已有结果为本回合写出收尾叙述。'
    : 'The tool budget for this turn is exhausted. Do NOT call any more tools. Using the results you already have, write the closing narration for this turn.';
}

/** Trim rolling history to the last N messages without breaking tool pairings. */
export function trimHistory(messages: ChatMessage[], max: number): ChatMessage[] {
  if (messages.length <= max) return messages;
  let start = messages.length - max;
  const isTool = (m: ChatMessage) => m.role === 'tool';
  const hasToolCalls = (m: ChatMessage) =>
    m.role === 'assistant' && (m.tool_calls?.length ?? 0) > 0;
  while (start < messages.length) {
    const message = messages[start];
    if (message && isTool(message)) {
      start += 1;
      continue;
    }
    if (message && hasToolCalls(message)) {
      const needed = message.tool_calls?.length ?? 0;
      let answered = 0;
      for (let i = start + 1; i < messages.length && isTool(messages[i] as ChatMessage); i++) {
        answered += 1;
      }
      if (answered < needed) {
        start += 1 + answered;
        continue;
      }
    }
    break;
  }
  return messages.slice(start);
}

const RECAP_LINE_LIMIT = 20;
const SUMMARY_BLOCK = /<summary>([\s\S]*?)<\/summary>/g;

/** One-line recaps extracted from the assistant texts of the trimmed-out messages. */
export function extractRecaps(messages: ChatMessage[]): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || typeof message.content !== 'string') continue;
    for (const match of message.content.matchAll(SUMMARY_BLOCK)) {
      const line = (match[1] ?? '').replace(/\s+/g, ' ').trim();
      if (line.length > 0) lines.push(line);
    }
  }
  return lines;
}

/**
 * Turn-local system message that replaces the messages cut off by
 * trimHistory: one line per `<summary>` block found in the cut region
 * (latest RECAP_LINE_LIMIT lines). Returns null when the cut region carries
 * no summaries at all (legacy histories / model omitted the block).
 */
export function recapMessage(cut: ChatMessage[], language: NarrativeLanguage): ChatMessage | null {
  const recaps = extractRecaps(cut).slice(-RECAP_LINE_LIMIT);
  if (recaps.length === 0) return null;
  const title =
    language === 'zh'
      ? '前情提要（更早的回合已离开上下文窗口，这里是其一句话概括）：'
      : 'STORY SO FAR (one-line recaps of earlier turns no longer in the context window):';
  return { role: 'system', content: [title, ...recaps.map((line) => `- ${line}`)].join('\n') };
}

function parseCallArgs(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function toolErrorMessage(diagnostic: LlmDiagnostic): string {
  return JSON.stringify({ error: { code: diagnostic.code, message: diagnostic.message } });
}

/**
 * One GM turn: system prompt (rebuilt each turn) + rolling history + user
 * input → streaming completion → engine tool execution → loop. When the tool
 * budget is reached the next request drops tools and demands a wrap-up.
 * Every request/response pair is recorded in `TurnResult.interactions`
 * (exact sent messages/tools + returned content/reasoning/tool calls).
 */
export async function runTurn(params: RunTurnParams): Promise<TurnResult> {
  const {
    config,
    history,
    userInput,
    executor,
    language,
    cyoa,
    style,
    customStyle,
    fetchImpl,
    signal,
    onTextDelta,
    onReasoningDelta,
    onRequest,
    onToolCall,
    onToolResult,
  } = params;
  const toolBudget = params.toolBudget ?? DEFAULT_TOOL_BUDGET;
  const maxHistory = params.maxHistoryMessages ?? DEFAULT_MAX_HISTORY;

  const system: ChatMessage = {
    role: 'system',
    content: buildSystemPrompt(executor.getState(), executor.index, language, {
      cyoa,
      style,
      customStyle,
    }),
  };
  const window = trimHistory(history, maxHistory);
  const cut = window.length < history.length ? history.slice(0, history.length - window.length) : [];
  const recap = recapMessage(cut, language);
  const localPrefix = recap ? 2 : 1;
  const messages: ChatMessage[] = [
    system,
    ...(recap ? [recap] : []),
    ...window,
    { role: 'user', content: userInput },
  ];

  const records: TurnToolRecord[] = [];
  const interactions: TurnInteraction[] = [];
  const usage = emptyUsage();
  let toolCount = 0;
  let budgetAnnounced = false;
  let budgetNoticeIndex: number | null = null;
  let truncatedByBudget = false;
  const maxRounds = toolBudget + 3;

  const finalize = (error?: LlmDiagnostic): TurnResult => {
    // turn-local messages (system prompt, recap, budget notice) do not leak
    // into history; trimming is request-only, so the cut messages stay in the
    // rolling history (their <summary> blocks keep feeding future recaps)
    if (budgetNoticeIndex !== null) messages.splice(budgetNoticeIndex, 1);
    const kept = messages.slice(localPrefix);
    return {
      messages: [...cut, ...kept],
      toolCalls: records,
      usage,
      truncatedByBudget,
      interactions,
      error,
    };
  };

  for (let round = 0; round < maxRounds; round++) {
    const offeredTools = budgetAnnounced ? undefined : TOOL_SPECS;
    // message objects are immutable once created, so a shallow slice captures
    // exactly what this request sends even as the loop keeps appending
    const requestMessages = messages.slice();
    onRequest?.({ round, messages: requestMessages, tools: offeredTools });
    let result: StreamResult;
    try {
      result = await streamChat({
        config,
        messages,
        tools: offeredTools,
        signal,
        fetchImpl,
        onTextDelta,
        onReasoningDelta,
      });
    } catch (e: unknown) {
      const error =
        e instanceof LlmError
          ? e.diagnostic
          : { code: 'network_error' as const, message: e instanceof Error ? e.message : String(e) };
      interactions.push({
        round,
        messages: requestMessages,
        tools: offeredTools,
        content: '',
        reasoning: '',
        toolCalls: [],
        finishReason: null,
        error,
      });
      sealDanglingToolCalls(messages, toolErrorMessage(error));
      return finalize(error);
    }
    addUsage(usage, result.usage);
    interactions.push({
      round,
      messages: requestMessages,
      tools: offeredTools,
      content: result.content,
      reasoning: result.reasoning,
      toolCalls: result.toolCalls,
      finishReason: result.finishReason,
    });

    if (result.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: result.content.length > 0 ? result.content : null,
        tool_calls: result.toolCalls,
      });
      if (budgetAnnounced) {
        // model violated the wrap-up instruction: refuse without executing
        for (const call of result.toolCalls) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify({
              error: {
                code: 'tool_budget_exhausted',
                message: 'no more tool calls this turn; write text instead',
              },
            }),
          });
        }
        continue;
      }
      for (const call of result.toolCalls) {
        const seq = records.length + 1;
        const args = parseCallArgs(call.function.arguments);
        onToolCall?.({ seq, name: call.function.name, args });
        const execution = executeToolCall(call.function.name, call.function.arguments, executor);
        const record: TurnToolRecord = {
          seq,
          name: call.function.name,
          args,
          execution,
          content: toolResultContent(execution),
        };
        records.push(record);
        onToolResult?.(record);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: record.content,
        });
      }
      toolCount += result.toolCalls.length;
      if (toolCount >= toolBudget && !budgetAnnounced) {
        budgetAnnounced = true;
        truncatedByBudget = true;
        messages.push({ role: 'system', content: budgetNotice(language) });
        budgetNoticeIndex = messages.length - 1;
      }
      continue;
    }

    messages.push({ role: 'assistant', content: result.content });
    return finalize();
  }

  return finalize();
}

/** Close unanswered tool_calls with an error tool message so history stays valid. */
function sealDanglingToolCalls(messages: ChatMessage[], content: string): void {
  const last = messages[messages.length - 1];
  if (!last || !(last.role === 'assistant' && (last.tool_calls?.length ?? 0) > 0)) return;
  for (const call of last.tool_calls ?? []) {
    messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content });
  }
}

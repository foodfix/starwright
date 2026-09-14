export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCallRequest {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: ToolCallRequest[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

export interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
  };
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface StreamResult {
  content: string;
  /** reasoning_content / reasoning aggregated (empty for non-reasoning models) */
  reasoning: string;
  toolCalls: ToolCallRequest[];
  finishReason: string | null;
  usage: ChatUsage;
}

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export interface StreamChatOptions {
  config: LlmConfig;
  messages: ChatMessage[];
  tools?: readonly ToolSpec[];
  signal?: AbortSignal;
  fetchImpl?: FetchImpl;
  onTextDelta?: (text: string) => void;
  /** live reasoning_content deltas (pass-through display only; never fed back) */
  onReasoningDelta?: (text: string) => void;
  /** non-streaming request (connection test); streaming remains the default */
  stream?: false;
}

export interface LlmDiagnostic {
  code:
    | 'auth_failed'
    | 'not_found'
    | 'rate_limited'
    | 'http_error'
    | 'network_error'
    | 'aborted'
    | 'no_function_calling'
    | 'malformed_response';
  message: string;
  status?: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  model: string;
  diagnostic?: LlmDiagnostic;
}

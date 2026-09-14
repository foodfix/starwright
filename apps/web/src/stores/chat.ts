import { create } from 'zustand';
import {
  LlmError,
  runTurn,
  type ChatMessage,
  type ChatUsage,
  type LlmDiagnostic,
  type TurnInteraction,
  type TurnRequestInfo,
  type TurnToolRecord,
} from '@starwright/ai';
import { useCampaign } from './campaign.js';
import { clearChat, saveChat } from '../persistence/db.js';
import { useSettings, type Settings } from './settings.js';
import { i18n } from '../i18n/index.js';
import { diagnosticText } from '../shared/diagnostics.js';

export interface ChatEntryUser {
  kind: 'user';
  id: number;
  text: string;
}

export interface ChatEntryAssistant {
  kind: 'assistant';
  id: number;
  text: string;
  streaming: boolean;
}

export interface ChatEntryError {
  kind: 'error';
  id: number;
  message: string;
  diagnostic?: LlmDiagnostic;
}

export interface ChatEntryInfo {
  kind: 'info';
  id: number;
  message: string;
}

/** wizard handoff: the campaign brief is sent to the GM but rendered collapsed */
export interface ChatEntryOpening {
  kind: 'opening';
  id: number;
  text: string;
}

/** tool settlements of a turn, merged into one collapsible strip */
export interface ChatEntryMechanics {
  kind: 'mechanics';
  id: number;
  records: TurnToolRecord[];
}

export type ChatEntry =
  | ChatEntryUser
  | ChatEntryAssistant
  | ChatEntryMechanics
  | ChatEntryError
  | ChatEntryInfo
  | ChatEntryOpening;

let nextId = 1;
let activeAbort: AbortController | null = null;

function snapshot() {
  const s = useChat.getState();
  return {
    entries: s.entries,
    history: s.history,
    toolLog: s.toolLog,
    usage: s.usage,
  };
}

function advanceNextId(entries: { id: number }[]): void {
  for (const entry of entries) nextId = Math.max(nextId, entry.id + 1);
}

function diagnosticMessage(diagnostic: LlmDiagnostic): string {
  return diagnosticText(diagnostic, (key) => i18n.t(key));
}

interface ChatStore {
  entries: ChatEntry[];
  history: ChatMessage[];
  toolLog: TurnToolRecord[];
  /** per-LLM-request audit records of the latest turn (memory only, not persisted) */
  interactions: TurnInteraction[];
  /** id of the assistant entry the latest turn's interactions hang under (memory only) */
  interactionAnchorId: number | null;
  usage: ChatUsage;
  busy: boolean;
  send(input: string, display?: 'user' | 'opening'): Promise<void>;
  /** push an opening prompt into the stream and run the turn (wizard handoff);
   *  the brief renders collapsed instead of as a player message */
  seedOpening(input: string): Promise<void>;
  /** UI-only info entry (e.g. Advance panel purchases); kept out of model history */
  pushInfo(message: string): void;
  /** abort the in-flight turn; executed tool results are kept */
  stop(): void;
  /** restore a persisted chat snapshot (called at boot after campaign restore) */
  hydrate(snapshot: {
    entries: unknown[];
    history: unknown[];
    toolLog: unknown[];
    usage: { promptTokens: number; completionTokens: number };
  }): boolean;
  /** replace the whole stream with an imported snapshot (save-file import) */
  replaceAll(snapshot: {
    entries: unknown[];
    history: unknown[];
    toolLog: unknown[];
    usage: { promptTokens: number; completionTokens: number };
  }): void;
  clear(): void;
}

export const useChat = create<ChatStore>((set, get) => ({
  entries: [],
  history: [],
  toolLog: [],
  interactions: [],
  interactionAnchorId: null,
  usage: { promptTokens: 0, completionTokens: 0 },
  busy: false,
  replaceAll: (snap) => {
    const entries = snap.entries as ChatEntry[];
    advanceNextId(entries);
    set({
      entries,
      history: snap.history as ChatMessage[],
      toolLog: snap.toolLog as TurnToolRecord[],
      interactions: [],
      interactionAnchorId: null,
      usage: snap.usage,
    });
    saveChat(snapshot());
  },
  clear: () => {
    void clearChat();
    set({
      entries: [],
      history: [],
      toolLog: [],
      interactions: [],
      interactionAnchorId: null,
      usage: { promptTokens: 0, completionTokens: 0 },
    });
  },
  seedOpening: (input) => get().send(input, 'opening'),
  pushInfo: (message) => {
    set((s) => ({ entries: [...s.entries, { kind: 'info', id: nextId++, message }] }));
    saveChat(snapshot());
  },
  stop: () => {
    activeAbort?.abort();
  },
  hydrate: (snapshot) => {
    if (get().entries.length > 0 || get().history.length > 0) return false;
    const entries = snapshot.entries as ChatEntry[];
    const ok = entries.every((e) => e && typeof e === 'object' && typeof e.kind === 'string');
    if (!ok) return false;
    advanceNextId(entries);
    set({
      entries,
      history: snapshot.history as ChatMessage[],
      toolLog: snapshot.toolLog as TurnToolRecord[],
      usage: snapshot.usage,
    });
    console.info('[starwright] chat restored', { entries: entries.length });
    return true;
  },
  send: async (input, display = 'user') => {
    console.info('[starwright] send invoked', { busy: get().busy, chars: input.length });
    if (get().busy) {
      console.warn('[starwright] send ignored: a turn is still in flight');
      return;
    }
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      console.warn('[starwright] send ignored: empty input');
      return;
    }
    const campaign = useCampaign.getState();
    const executor = campaign.executor;
    if (!executor) {
      console.error('[starwright] send ignored: no executor (campaign not initialized)', {
        hasIndex: campaign.index !== null,
        hasState: campaign.state !== null,
        restored: campaign.restored,
      });
      return;
    }
    const {
      config,
      toolBudget,
      narrativeLanguage,
      narrativeStyle,
      customStyle,
      cyoa,
      historyLimit,
    } = settingsSnapshot();
    const openingEntry: ChatEntryOpening = { kind: 'opening', id: nextId++, text: trimmed };
    const userEntry: ChatEntryUser = { kind: 'user', id: nextId++, text: trimmed };
    const assistantEntry: ChatEntryAssistant = {
      kind: 'assistant',
      id: nextId++,
      text: '',
      streaming: true,
    };
    set((s) => ({
      entries: [...s.entries, display === 'user' ? userEntry : openingEntry, assistantEntry],
      interactions: [],
      interactionAnchorId: assistantEntry.id,
      busy: true,
    }));
    console.info('[starwright] turn started', { baseUrl: config.baseUrl, model: config.model });
    const patchAssistant = (text: string): void => {
      set((s) => ({
        entries: s.entries.map((e) =>
          e.id === assistantEntry.id && e.kind === 'assistant' ? { ...e, text: e.text + text } : e,
        ),
      }));
    };
    const addTool = (record: TurnToolRecord): void => {
      set((s) => {
        const last = s.entries[s.entries.length - 1];
        // merge consecutive settlements into one collapsible strip
        if (last && last.kind === 'mechanics') {
          return {
            entries: [...s.entries.slice(0, -1), { ...last, records: [...last.records, record] }],
            toolLog: [...s.toolLog, record],
          };
        }
        return {
          entries: [...s.entries, { kind: 'mechanics', id: nextId++, records: [record] }],
          toolLog: [...s.toolLog, record],
        };
      });
    };
    // live interaction audit: one record per request, reasoning streamed in
    const addInteraction = (request: TurnRequestInfo): void => {
      console.info('[starwright] llm request', {
        round: request.round,
        roles: request.messages.map((m) => m.role),
        tools: request.tools ? request.tools.length : 0,
      });
      set((s) => ({
        interactions: [
          ...s.interactions,
          {
            round: request.round,
            messages: request.messages,
            tools: request.tools,
            content: '',
            reasoning: '',
            toolCalls: [],
            finishReason: null,
          },
        ],
      }));
    };
    const patchReasoning = (text: string): void => {
      set((s) => {
        const last = s.interactions[s.interactions.length - 1];
        if (!last) return {};
        return {
          interactions: [
            ...s.interactions.slice(0, -1),
            { ...last, reasoning: last.reasoning + text },
          ],
        };
      });
    };
    try {
      activeAbort = new AbortController();
      const result = await runTurn({
        config,
        history: get().history,
        userInput: trimmed,
        executor,
        language: narrativeLanguage,
        style: narrativeStyle,
        customStyle,
        cyoa,
        toolBudget,
        maxHistoryMessages: historyLimit,
        signal: activeAbort.signal,
        onTextDelta: patchAssistant,
        onReasoningDelta: patchReasoning,
        onRequest: addInteraction,
        onToolResult: addTool,
      });
      console.info('[starwright] turn finished', {
        toolCalls: result.toolCalls.length,
        rounds: result.interactions.length,
        error: result.error?.code,
        usage: result.usage,
      });
      set((s) => ({
        entries: s.entries.map((e) =>
          e.id === assistantEntry.id && e.kind === 'assistant' ? { ...e, streaming: false } : e,
        ),
        history: result.messages,
        interactions: result.interactions,
        usage: {
          promptTokens: s.usage.promptTokens + result.usage.promptTokens,
          completionTokens: s.usage.completionTokens + result.usage.completionTokens,
        },
      }));
      if (result.error) {
        const diagnostic = result.error as LlmDiagnostic;
        console.warn('[starwright] turn finished with error', diagnostic);
        set((s) => ({
          entries: [
            ...s.entries,
            diagnostic.code === 'aborted'
              ? { kind: 'info', id: nextId++, message: i18n.t('diag.turnStopped') }
              : {
                  kind: 'error',
                  id: nextId++,
                  message: diagnosticMessage(diagnostic),
                  diagnostic,
                },
          ],
        }));
      }
    } catch (e: unknown) {
      console.error('[starwright] turn threw', e);
      const aborted =
        (e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError');
      const diagnostic = e instanceof LlmError ? e.diagnostic : undefined;
      set((s) => ({
        entries: [
          ...s.entries,
          aborted || diagnostic?.code === 'aborted'
            ? { kind: 'info', id: nextId++, message: i18n.t('diag.turnStopped') }
            : {
                kind: 'error',
                id: nextId++,
                message: e instanceof Error ? e.message : String(e),
                diagnostic,
              },
        ],
      }));
    } finally {
      activeAbort = null;
      saveChat(snapshot());
      console.info('[starwright] turn settled, busy released');
      set((s) => ({
        busy: false,
        entries: s.entries.map((e) =>
          e.id === assistantEntry.id && e.kind === 'assistant' ? { ...e, streaming: false } : e,
        ),
      }));
    }
  },
}));

function settingsSnapshot(): {
  config: ReturnType<ReturnType<typeof useSettings.getState>['config']>;
  toolBudget: number;
  narrativeLanguage: 'zh' | 'en';
  narrativeStyle: Settings['narrativeStyle'];
  customStyle: string;
  cyoa: boolean;
  historyLimit: number;
} {
  const store = useSettings.getState();
  return {
    config: store.config(),
    toolBudget: store.settings.toolBudget,
    narrativeLanguage: store.settings.narrativeLanguage,
    narrativeStyle: store.settings.narrativeStyle,
    customStyle: store.settings.customStyle,
    cyoa: store.settings.cyoa,
    historyLimit: store.settings.historyLimit,
  };
}

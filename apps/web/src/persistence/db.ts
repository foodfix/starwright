import Dexie, { type Table } from 'dexie';
import type { CampaignState } from '@starwright/engine';

export interface SaveRecord {
  key: string;
  state: CampaignState;
  savedAt: number;
}

export interface ChatRecord {
  key: string;
  version: number;
  entries: unknown[];
  history: unknown[];
  toolLog: unknown[];
  usage: { promptTokens: number; completionTokens: number };
  savedAt: number;
}

const CAMPAIGN_KEY = 'campaign';
const CHAT_KEY = 'chat';
const CHAT_VERSION = 1;

class StarforgeDb extends Dexie {
  saves!: Table<SaveRecord | ChatRecord, string>;

  constructor() {
    super('starwright.v1');
    this.version(1).stores({ saves: 'key' });
  }
}

let db: StarforgeDb | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 500;

function getDb(): StarforgeDb {
  if (!db) db = new StarforgeDb();
  return db;
}

export async function loadCampaign(): Promise<CampaignState | null> {
  try {
    const record = await getDb().saves.get(CAMPAIGN_KEY);
    return record && 'state' in record ? (record.state ?? null) : null;
  } catch {
    // IndexedDB unavailable (private mode): run without persistence
    return null;
  }
}

/** Debounced auto-save; every reducer result funnels through here. */
export function saveCampaign(state: CampaignState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    getDb()
      .saves.put({ key: CAMPAIGN_KEY, state, savedAt: Date.now() })
      .catch(() => {
        // storage unavailable: keep playing in memory
      });
  }, SAVE_DEBOUNCE_MS);
}

/** Force-write immediately (wizard completion, beforeunload best effort). */
export function saveCampaignNow(state: CampaignState): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return getDb()
    .saves.put({ key: CAMPAIGN_KEY, state, savedAt: Date.now() })
    .then(() => undefined)
    .catch(() => undefined);
}

export async function clearCampaign(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    await getDb().saves.delete(CAMPAIGN_KEY);
  } catch {
    // storage unavailable
  }
}

/* ---------- chat stream persistence ---------- */

let chatTimer: ReturnType<typeof setTimeout> | null = null;

export function saveChat(snapshot: {
  entries: unknown[];
  history: unknown[];
  toolLog: unknown[];
  usage: { promptTokens: number; completionTokens: number };
}): void {
  if (chatTimer) clearTimeout(chatTimer);
  chatTimer = setTimeout(() => {
    chatTimer = null;
    getDb()
      .saves.put({
        key: CHAT_KEY,
        version: CHAT_VERSION,
        entries: snapshot.entries,
        history: snapshot.history,
        toolLog: snapshot.toolLog,
        usage: snapshot.usage,
        savedAt: Date.now(),
      })
      .catch(() => {
        // storage unavailable: keep chatting in memory
      });
  }, SAVE_DEBOUNCE_MS);
}

export async function loadChat(): Promise<{
  entries: unknown[];
  history: unknown[];
  toolLog: unknown[];
  usage: { promptTokens: number; completionTokens: number };
} | null> {
  try {
    const record = (await getDb().saves.get(CHAT_KEY)) as ChatRecord | undefined;
    if (!record || record.version !== CHAT_VERSION) return null;
    if (!Array.isArray(record.entries) || !Array.isArray(record.history)) return null;
    return {
      entries: record.entries,
      history: record.history,
      toolLog: record.toolLog ?? [],
      usage: record.usage ?? { promptTokens: 0, completionTokens: 0 },
    };
  } catch {
    return null;
  }
}

export async function clearChat(): Promise<void> {
  if (chatTimer) {
    clearTimeout(chatTimer);
    chatTimer = null;
  }
  try {
    await getDb().saves.delete(CHAT_KEY);
  } catch {
    // storage unavailable
  }
}

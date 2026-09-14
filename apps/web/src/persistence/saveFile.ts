import { migrateCampaignState, STATE_VERSION, type CampaignState } from '@starwright/engine';

/** snapshot of the chat stream as persisted alongside the campaign */
export interface SaveFileChatSnapshot {
  entries: unknown[];
  history: unknown[];
  toolLog: unknown[];
  usage: { promptTokens: number; completionTokens: number };
}

/** exported save file: campaign state (with its own version) + chat stream */
export interface SaveFile {
  kind: 'starwright-save' | 'starforge-save';
  fileVersion: 1;
  exportedAt: string;
  campaign: CampaignState;
  chat: SaveFileChatSnapshot | null;
}

/** current export marker; `starforge-save` is the legacy (pre-rename) marker, still accepted on import */
const SAVE_KIND = 'starwright-save';
const LEGACY_SAVE_KIND = 'starforge-save';

export type SaveFileError =
  'notSaveFile' | 'badCampaign' | 'cannotMigrate' | 'unsupportedVersion' | 'badChat';

export type ParsedSaveFile =
  | { ok: true; campaign: CampaignState; chat: SaveFileChatSnapshot | null }
  | { ok: false; error: SaveFileError };

export function buildSaveFile(
  campaign: CampaignState,
  chat: SaveFileChatSnapshot | null,
  exportedAt: string = new Date().toISOString(),
): SaveFile {
  return {
    kind: SAVE_KIND,
    fileVersion: 1,
    exportedAt,
    campaign: structuredClone(campaign),
    chat: chat ? structuredClone(chat) : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseChat(raw: unknown): SaveFileChatSnapshot | null | SaveFileError {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) return 'badChat';
  if (!Array.isArray(raw.entries) || !Array.isArray(raw.history)) return 'badChat';
  const usage = raw.usage;
  const zeroUsage = { promptTokens: 0, completionTokens: 0 };
  if (!isRecord(usage))
    return {
      entries: raw.entries,
      history: raw.history,
      toolLog: Array.isArray(raw.toolLog) ? raw.toolLog : [],
      usage: zeroUsage,
    };
  if (typeof usage.promptTokens !== 'number' || typeof usage.completionTokens !== 'number') {
    return 'badChat';
  }
  return {
    entries: raw.entries,
    history: raw.history,
    toolLog: Array.isArray(raw.toolLog) ? raw.toolLog : [],
    usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens },
  };
}

/**
 * Validate an exported save file and run the campaign state through the
 * migration chain. Never throws: failures come back as readable error codes
 * (i18n keys `saveFile.<code>`), leaving the current save untouched.
 */
export function parseSaveFile(raw: unknown): ParsedSaveFile {
  const kind = isRecord(raw) ? raw['kind'] : undefined;
  if (
    !isRecord(raw) ||
    (kind !== SAVE_KIND && kind !== LEGACY_SAVE_KIND) ||
    raw['fileVersion'] !== 1
  ) {
    return { ok: false, error: 'notSaveFile' };
  }
  const rawCampaign = raw['campaign'];
  if (!isRecord(rawCampaign) || typeof rawCampaign['version'] !== 'number') {
    return { ok: false, error: 'badCampaign' };
  }
  let campaign: CampaignState;
  try {
    campaign = migrateCampaignState(rawCampaign as unknown as CampaignState);
  } catch {
    return { ok: false, error: 'cannotMigrate' };
  }
  if (campaign.version !== STATE_VERSION) {
    return { ok: false, error: 'unsupportedVersion' };
  }
  const chat = parseChat(raw['chat']);
  if (typeof chat === 'string') return { ok: false, error: chat };
  return { ok: true, campaign, chat };
}

/** `starwright-save-20260915-1533.json` */
export function saveFileName(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `starwright-save-${date}-${time}.json`;
}

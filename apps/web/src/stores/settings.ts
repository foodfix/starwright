import { create } from 'zustand';
import type { LlmConfig, NarrativeLanguage, NarrativeStyle } from '@starwright/ai';
import { CUSTOM_STYLE_MAX_LENGTH, NARRATIVE_STYLES } from '@starwright/ai';
import type { UiLanguage } from '../i18n/index.js';

const STORAGE_KEY = 'starwright.settings.v1';

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  narrativeLanguage: NarrativeLanguage;
  /** GM narration style preset passed to runTurn's style (default classic; 'custom' uses customStyle) */
  narrativeStyle: NarrativeStyle;
  /** player-written narration style text, injected when narrativeStyle is 'custom' */
  customStyle: string;
  toolBudget: number;
  /** rolling-history cap (messages) passed to runTurn as maxHistoryMessages;
   *  turns trimmed out are replaced by one-line recaps */
  historyLimit: number;
  /** CYOA: offer 5 tappable action choices after each GM turn */
  cyoa: boolean;
  /** debug mode: allow direct editing of the character panel (left column) */
  debug: boolean;
  uiLanguage: UiLanguage;
  /** left character-panel width in px (drag the separator to change it) */
  leftPanelWidth: number;
}

export const LEFT_PANEL_MIN = 200;
export const LEFT_PANEL_MAX = 560;
export const LEFT_PANEL_DEFAULT = 280;

/** clamp a desired left-panel width to the allowed range */
export function clampLeftPanelWidth(value: number): number {
  if (!Number.isFinite(value)) return LEFT_PANEL_DEFAULT;
  return Math.min(LEFT_PANEL_MAX, Math.max(LEFT_PANEL_MIN, Math.round(value)));
}

export const HISTORY_LIMIT_MIN = 10;
export const HISTORY_LIMIT_MAX = 100;
export const HISTORY_LIMIT_DEFAULT = 40;

/** clamp a desired history limit to the allowed range */
export function clampHistoryLimit(value: number): number {
  if (!Number.isFinite(value)) return HISTORY_LIMIT_DEFAULT;
  return Math.min(HISTORY_LIMIT_MAX, Math.max(HISTORY_LIMIT_MIN, Math.round(value)));
}

/** normalize the custom style text the same way the prompt builder does */
export function clampCustomStyle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_STYLE_MAX_LENGTH);
}

const DEFAULT_SETTINGS: Settings = {
  baseUrl: '',
  apiKey: '',
  model: '',
  narrativeLanguage: 'en',
  narrativeStyle: 'classic',
  customStyle: '',
  toolBudget: 12,
  historyLimit: HISTORY_LIMIT_DEFAULT,
  cyoa: true,
  debug: false,
  uiLanguage: 'en',
  leftPanelWidth: LEFT_PANEL_DEFAULT,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...pickKnown(parsed) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** ignore unknown/stale fields from older storage shapes (e.g. presetId) */
function pickKnown(parsed: Partial<Settings>): Partial<Settings> {
  const known: Partial<Settings> = {};
  if (typeof parsed.baseUrl === 'string') known.baseUrl = parsed.baseUrl;
  if (typeof parsed.apiKey === 'string') known.apiKey = parsed.apiKey;
  if (typeof parsed.model === 'string') known.model = parsed.model;
  if (parsed.narrativeLanguage === 'zh' || parsed.narrativeLanguage === 'en') {
    known.narrativeLanguage = parsed.narrativeLanguage;
  }
  if (
    typeof parsed.narrativeStyle === 'string' &&
    ((NARRATIVE_STYLES as readonly string[]).includes(parsed.narrativeStyle) ||
      parsed.narrativeStyle === 'custom')
  ) {
    known.narrativeStyle = parsed.narrativeStyle as NarrativeStyle;
  }
  if (typeof parsed.customStyle === 'string') {
    known.customStyle = clampCustomStyle(parsed.customStyle);
  }
  if (typeof parsed.toolBudget === 'number') known.toolBudget = parsed.toolBudget;
  if (typeof parsed.historyLimit === 'number') {
    known.historyLimit = clampHistoryLimit(parsed.historyLimit);
  }
  if (typeof parsed.cyoa === 'boolean') known.cyoa = parsed.cyoa;
  if (typeof parsed.debug === 'boolean') known.debug = parsed.debug;
  if (parsed.uiLanguage === 'zh' || parsed.uiLanguage === 'en') {
    known.uiLanguage = parsed.uiLanguage;
  }
  if (typeof parsed.leftPanelWidth === 'number') {
    known.leftPanelWidth = clampLeftPanelWidth(parsed.leftPanelWidth);
  }
  return known;
}

function persist(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable (private mode): settings stay in memory only
  }
}

interface SettingsStore {
  settings: Settings;
  update(patch: Partial<Settings>): void;
  config(): LlmConfig;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: loadSettings(),
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    persist(settings);
    set({ settings });
  },
  config: () => {
    const { baseUrl, apiKey, model } = get().settings;
    return { baseUrl, apiKey, model };
  },
}));

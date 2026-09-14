import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { loadStarforged } from '@starwright/data';
import { useCampaign } from './stores/campaign.js';
import { useChat } from './stores/chat.js';
import {
  useSettings,
  LEFT_PANEL_DEFAULT,
  LEFT_PANEL_MAX,
  LEFT_PANEL_MIN,
  clampLeftPanelWidth,
} from './stores/settings.js';
import { loadChat } from './persistence/db.js';
import { SettingsPanel } from './features/settings/SettingsPanel.js';
import { NarrativeView } from './features/narrative/NarrativeView.js';
import { CharacterPanel } from './features/character/CharacterPanel.js';
import { ToolLogPanel } from './features/gmpanel/ToolLogPanel.js';
import { Wizard } from './features/wizard/Wizard.js';
import { buildOpeningPrompt, validateWizardInput, type WizardInput } from './persistence/wizard.js';

console.info('[starwright] app code loaded (M6 build with diagnostics)');

export function App() {
  const { t } = useTranslation();
  const [boot, setBoot] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bootError, setBootError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const index = useCampaign((s) => s.index);
  const state = useCampaign((s) => s.state);
  const restored = useCampaign((s) => s.restored);
  const toolLog = useChat((s) => s.toolLog);
  const usage = useChat((s) => s.usage);
  const uiLanguage = useSettings((s) => s.settings.uiLanguage);
  const configured = useSettings((s) => Boolean(s.settings.baseUrl && s.settings.model));
  const leftPanelWidth = useSettings((s) => s.settings.leftPanelWidth);

  // left-panel resize: live width while dragging, committed to settings on release
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const panelWidth = liveWidth ?? leftPanelWidth;
  const dragging = liveWidth !== null;

  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add('column-resizing');
    return () => document.body.classList.remove('column-resizing');
  }, [dragging]);

  const resizeFromPointer = (e: PointerEvent<HTMLDivElement>): number =>
    clampLeftPanelWidth(
      (dragStart.current?.width ?? leftPanelWidth) +
        e.clientX -
        (dragStart.current?.x ?? e.clientX),
    );

  const onResizerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, width: leftPanelWidth };
    setLiveWidth(leftPanelWidth);
  };

  const onResizerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragStart.current) return;
    setLiveWidth(resizeFromPointer(e));
  };

  const onResizerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragStart.current) return;
    const next = resizeFromPointer(e);
    dragStart.current = null;
    setLiveWidth(null);
    useSettings.getState().update({ leftPanelWidth: next });
  };

  const onResizerCancel = (): void => {
    dragStart.current = null;
    setLiveWidth(null);
  };

  const onResizerDoubleClick = (): void => {
    onResizerCancel();
    useSettings.getState().update({ leftPanelWidth: LEFT_PANEL_DEFAULT });
  };

  const onResizerKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const commit = (width: number): void => {
      e.preventDefault();
      useSettings.getState().update({ leftPanelWidth: clampLeftPanelWidth(width) });
    };
    if (e.key === 'ArrowLeft') commit(leftPanelWidth - 16);
    else if (e.key === 'ArrowRight') commit(leftPanelWidth + 16);
    else if (e.key === 'Home') commit(LEFT_PANEL_MIN);
    else if (e.key === 'End') commit(LEFT_PANEL_MAX);
  };

  // keep the document language in sync for a11y and font rendering
  useEffect(() => {
    document.documentElement.lang = uiLanguage === 'zh' ? 'zh-CN' : 'en';
  }, [uiLanguage]);

  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.BASE_URL;
    // zh UI loads the pre-translated dataset; fall back to English if absent
    const urls =
      uiLanguage === 'zh'
        ? [`${base}data/starforged.zh.json`, `${base}data/starforged.json`]
        : [`${base}data/starforged.json`];
    const load = async (): Promise<void> => {
      let lastError: unknown;
      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const raw = (await res.json()) as unknown;
          if (cancelled) return;
          const dataLang: 'en' | 'zh' = url.endsWith('.zh.json') ? 'zh' : 'en';
          console.info(`[starwright] game data loaded (${dataLang}), restoring save if any`);
          await useCampaign.getState().setIndex(loadStarforged(raw).index, dataLang);
          if (useCampaign.getState().state) {
            const saved = await loadChat();
            if (saved) useChat.getState().hydrate(saved);
          }
          setBoot('ready');
          return;
        } catch (err) {
          lastError = err;
        }
      }
      if (!cancelled) {
        setBootError(lastError instanceof Error ? lastError.message : String(lastError));
        setBoot('error');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [uiLanguage]);

  const startCampaign = (raw: WizardInput): void => {
    const store = useCampaign.getState();
    if (!store.index) return;
    const validated = validateWizardInput(raw, store.index);
    if (!validated.input) {
      console.error('[starwright] wizard input invalid', validated.errors);
      return;
    }
    console.debug('[starwright] wizard complete, starting campaign');
    // start the new campaign with a clean slate: no leftover panel UI from the
    // previous session (e.g. Settings was open when the save was deleted)
    setSettingsOpen(false);
    setLogOpen(false);
    useChat.getState().clear();
    store.startCampaign(validated.input);
    void useChat.getState().seedOpening(buildOpeningPrompt(raw, store.index));
  };

  if (boot === 'loading') {
    return (
      <main className="app-boot">
        <h1>Starwright</h1>
        <p className="hint">{t('app.loading')}</p>
      </main>
    );
  }
  if (boot === 'error' || !index) {
    return (
      <main className="app-boot">
        <h1>Starwright</h1>
        <p className="msg error">{t('app.loadFailed', { error: bootError ?? '' })}</p>
      </main>
    );
  }
  if (!state || !restored) {
    return (
      <>
        <header className="topbar">
          <h1>Starwright</h1>
          <span className="tagline">{t('app.tagline')}</span>
          <button
            type="button"
            className={configured ? 'ghost topbar-right' : 'ghost attention topbar-right'}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            {configured ? t('app.settings') : t('app.configureAi')}
          </button>
        </header>
        <main className="app-shell">
          {settingsOpen && <SettingsPanel />}
          <Wizard index={index} onComplete={startCampaign} />
        </main>
      </>
    );
  }

  return (
    <div className="layout">
      <header className="topbar">
        <h1>Starwright</h1>
        <span className="tagline">{t('app.tagline')}</span>
        <span className="usage">
          {usage.promptTokens > 0
            ? t('app.usage', {
                input: usage.promptTokens.toLocaleString(),
                output: usage.completionTokens.toLocaleString(),
              })
            : ''}
        </span>
        <button
          type="button"
          className={logOpen ? 'ghost' : 'ghost dim'}
          onClick={() => setLogOpen((open) => !open)}
        >
          {t('app.mechanicsLog')}
        </button>
        <button
          type="button"
          className={configured ? 'ghost' : 'ghost attention'}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          {configured ? t('app.settings') : t('app.configureAi')}
        </button>
      </header>
      <main
        className={logOpen ? 'columns with-log' : 'columns'}
        style={{ '--left-width': `${panelWidth}px` } as CSSProperties}
      >
        <aside className="column left">{state && <CharacterPanel state={state} />}</aside>
        <div
          className={dragging ? 'column-resizer dragging' : 'column-resizer'}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('app.resizePanel')}
          aria-valuenow={panelWidth}
          aria-valuemin={LEFT_PANEL_MIN}
          aria-valuemax={LEFT_PANEL_MAX}
          tabIndex={0}
          onPointerDown={onResizerDown}
          onPointerMove={onResizerMove}
          onPointerUp={onResizerUp}
          onPointerCancel={onResizerCancel}
          onDoubleClick={onResizerDoubleClick}
          onKeyDown={onResizerKeyDown}
        />
        <div className="column center">
          {settingsOpen && <SettingsPanel />}
          <NarrativeView />
        </div>
        {logOpen && (
          <aside className="column right">
            <ToolLogPanel records={toolLog} />
          </aside>
        )}
      </main>
    </div>
  );
}

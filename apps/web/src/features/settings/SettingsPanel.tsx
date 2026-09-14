import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { testConnection, type ConnectionTestResult, type NarrativeStyle } from '@starwright/ai';
import type { CampaignState } from '@starwright/engine';
import {
  useSettings,
  clampHistoryLimit,
  clampCustomStyle,
  HISTORY_LIMIT_MIN,
  HISTORY_LIMIT_MAX,
} from '../../stores/settings.js';
import { useCampaign } from '../../stores/campaign.js';
import { useChat } from '../../stores/chat.js';
import { i18n } from '../../i18n/index.js';
import { diagnosticText } from '../../shared/diagnostics.js';
import {
  buildSaveFile,
  parseSaveFile,
  saveFileName,
  type SaveFileChatSnapshot,
} from '../../persistence/saveFile.js';

const EMPTY_CHAT: SaveFileChatSnapshot = {
  entries: [],
  history: [],
  toolLog: [],
  usage: { promptTokens: 0, completionTokens: 0 },
};

interface PendingImport {
  name: string;
  campaign: CampaignState;
  chat: SaveFileChatSnapshot | null;
}

export function SettingsPanel() {
  const { t } = useTranslation();
  const { settings, update, config } = useSettings();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);

  const runTest = async (): Promise<void> => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await testConnection(config()));
    } catch (e: unknown) {
      setResult({
        ok: false,
        latencyMs: 0,
        model: settings.model,
        diagnostic: { code: 'network_error', message: e instanceof Error ? e.message : String(e) },
      });
    } finally {
      setTesting(false);
    }
  };

  const doExport = (): void => {
    const campaign = useCampaign.getState().state;
    if (!campaign) return;
    const chat = useChat.getState();
    const file = buildSaveFile(campaign, {
      entries: chat.entries,
      history: chat.history,
      toolLog: chat.toolLog,
      usage: chat.usage,
    });
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = saveFileName();
    link.click();
    URL.revokeObjectURL(url);
  };

  const chooseImport = (file: File | undefined): void => {
    setPendingImport(null);
    setImportError(null);
    setImportSuccess(false);
    if (!file) return;
    void (async () => {
      try {
        const text = await file.text();
        const parsed = parseSaveFile(JSON.parse(text) as unknown);
        if (!parsed.ok) {
          setImportError(parsed.error);
          return;
        }
        setPendingImport({ name: file.name, campaign: parsed.campaign, chat: parsed.chat });
      } catch {
        setImportError('notSaveFile');
      }
    })();
  };

  const confirmImport = (): void => {
    if (!pendingImport) return;
    useCampaign.getState().importState(pendingImport.campaign);
    useChat.getState().replaceAll(pendingImport.chat ?? EMPTY_CHAT);
    setPendingImport(null);
    setImportSuccess(true);
  };

  return (
    <section className="settings" aria-label={t('settings.title')}>
      <h2>{t('settings.title')}</h2>
      <p className="hint">{t('settings.hint')}</p>
      <label className="field">
        <span>{t('settings.baseUrl')}</span>
        <input
          type="text"
          value={settings.baseUrl}
          onChange={(e) => update({ baseUrl: e.target.value })}
          placeholder="https://your-endpoint/v1"
        />
      </label>
      <label className="field">
        <span>{t('settings.apiKey')}</span>
        <input
          type="password"
          value={settings.apiKey}
          onChange={(e) => update({ apiKey: e.target.value })}
          placeholder="sk-…"
          autoComplete="off"
        />
      </label>
      <label className="field">
        <span>{t('settings.model')}</span>
        <input
          type="text"
          value={settings.model}
          onChange={(e) => update({ model: e.target.value })}
          placeholder="model id"
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span>{t('settings.narrationLanguage')}</span>
          <select
            value={settings.narrativeLanguage}
            onChange={(e) => update({ narrativeLanguage: e.target.value as 'zh' | 'en' })}
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </label>
        <label className="field">
          <span>{t('settings.uiLanguage')}</span>
          <select
            value={settings.uiLanguage}
            onChange={(e) => {
              const lang = e.target.value === 'zh' ? 'zh' : 'en';
              update({ uiLanguage: lang });
              void i18n.changeLanguage(lang);
            }}
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </label>
        <label className="field">
          <span>{t('settings.toolBudget')}</span>
          <input
            type="number"
            min={1}
            max={30}
            value={settings.toolBudget}
            onChange={(e) => update({ toolBudget: Math.max(1, Number(e.target.value) || 12) })}
          />
        </label>
        <label className="field">
          <span>{t('settings.historyLimit')}</span>
          <input
            type="number"
            min={HISTORY_LIMIT_MIN}
            max={HISTORY_LIMIT_MAX}
            value={settings.historyLimit}
            onChange={(e) => update({ historyLimit: clampHistoryLimit(Number(e.target.value)) })}
          />
        </label>
      </div>
      <p className="hint">{t('settings.historyLimitHint')}</p>
      <label className="field">
        <span>{t('settings.narrativeStyle')}</span>
        <select
          value={settings.narrativeStyle}
          onChange={(e) => update({ narrativeStyle: e.target.value as NarrativeStyle })}
        >
          <option value="classic">{t('settings.styleClassic')}</option>
          <option value="concise">{t('settings.styleConcise')}</option>
          <option value="literary">{t('settings.styleLiterary')}</option>
          <option value="humorous">{t('settings.styleHumorous')}</option>
          <option value="hardboiled">{t('settings.styleHardboiled')}</option>
          <option value="custom">{t('settings.styleCustom')}</option>
        </select>
      </label>
      {settings.narrativeStyle === 'custom' && (
        <>
          <label className="field">
            <span>{t('settings.customStyle')}</span>
            <textarea
              rows={3}
              maxLength={600}
              value={settings.customStyle}
              onChange={(e) => update({ customStyle: clampCustomStyle(e.target.value) })}
              placeholder={t('settings.customStylePlaceholder')}
            />
          </label>
          <p className="hint">{t('settings.customStyleHint')}</p>
        </>
      )}
      <p className="hint">{t('settings.narrativeStyleHint')}</p>
      <label className="field field-check">
        <input
          type="checkbox"
          checked={settings.cyoa}
          onChange={(e) => update({ cyoa: e.target.checked })}
        />
        <span>{t('settings.cyoa')}</span>
      </label>
      <p className="hint">{t('settings.cyoaHint')}</p>
      <label className="field field-check">
        <input
          type="checkbox"
          checked={settings.debug}
          onChange={(e) => update({ debug: e.target.checked })}
        />
        <span>{t('settings.debug')}</span>
      </label>
      <p className="hint">{t('settings.debugHint')}</p>
      <div className="field-row">
        <button type="button" onClick={() => void runTest()} disabled={testing}>
          {testing ? t('settings.testing') : t('settings.test')}
        </button>
        {result && (
          <span className={result.ok ? 'test-ok' : 'test-fail'}>
            {result.ok
              ? t('settings.testOk', { ms: result.latencyMs })
              : t('settings.testFail', {
                  code: result.diagnostic?.code ?? 'unknown',
                  message: result.diagnostic
                    ? diagnosticText(result.diagnostic, (key) => t(key))
                    : '',
                })}
          </span>
        )}
      </div>
      <p className="hint">{t('settings.keyHint')}</p>

      <h2>{t('settings.dataTitle')}</h2>
      <p className="hint">{t('settings.dataHint')}</p>
      <div className="field-row">
        <button type="button" onClick={doExport}>
          {t('settings.exportSave')}
        </button>
        <label className="field import-label">
          <span className="visually-hidden">{t('settings.importSave')}</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => chooseImport(e.target.files?.[0])}
            disabled={pendingImport !== null}
          />
        </label>
      </div>
      {importSuccess && !pendingImport && <p className="test-ok">{t('settings.importSuccess')}</p>}
      {importError && (
        <p className="msg error">
          {t('settings.importFailed', { reason: t(`saveFile.${importError}`) })}
        </p>
      )}
      {pendingImport && (
        <div className="field-row">
          <span className="hint">{t('settings.importPending', { file: pendingImport.name })}</span>
          <button type="button" className="danger" onClick={confirmImport}>
            {t('settings.importConfirm')}
          </button>
          <button type="button" className="ghost" onClick={() => setPendingImport(null)}>
            {t('settings.cancel')}
          </button>
        </div>
      )}
      {confirmReset ? (
        <div className="field-row">
          <button
            type="button"
            className="danger"
            onClick={() => {
              void useCampaign.getState().reset();
              useChat.getState().clear();
              setConfirmReset(false);
            }}
          >
            {t('settings.confirmDelete')}
          </button>
          <button type="button" className="ghost" onClick={() => setConfirmReset(false)}>
            {t('settings.cancel')}
          </button>
        </div>
      ) : (
        <button type="button" className="danger" onClick={() => setConfirmReset(true)}>
          {t('settings.deleteCampaign')}
        </button>
      )}

      <h2>{t('settings.aboutTitle')}</h2>
      <p className="hint">{t('settings.aboutLicenseCode')}</p>
      <p className="hint">{t('settings.aboutLicenseContent')}</p>
    </section>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { translateText } from '@starwright/ai';
import { useCampaign } from '../stores/campaign.js';
import { useSettings } from '../stores/settings.js';
import { DataswornText } from './DataswornText.js';
import { cachedTranslation, storeTranslation } from './translation.js';

interface TranslatableProps {
  text: string;
  className?: string;
}

/**
 * Game-data text with an AI-translate toggle for zh UI users when the loaded
 * dataset is not localized (English fallback). Translations call the
 * configured LLM and are cached in localStorage keyed by target language +
 * text hash. When the pre-translated zh dataset is active the text renders
 * directly without a button.
 */
export function Translatable({ text, className }: TranslatableProps): ReactNode {
  const { t } = useTranslation();
  const uiLanguage = useSettings((s) => s.settings.uiLanguage);
  const dataLang = useCampaign((s) => s.dataLang);
  // select primitives (not s.config(), which would return a fresh object per snapshot)
  const baseUrl = useSettings((s) => s.settings.baseUrl);
  const apiKey = useSettings((s) => s.settings.apiKey);
  const model = useSettings((s) => s.settings.model);
  const config = { baseUrl, apiKey, model };
  const configured = Boolean(baseUrl && model);
  const localized = uiLanguage === 'zh' && dataLang === 'zh';
  const [shown, setShown] = useState<string | null>(() =>
    uiLanguage === 'zh' && !localized ? (cachedTranslation('zh', text) ?? null) : null,
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setShown(uiLanguage === 'zh' && !localized ? (cachedTranslation('zh', text) ?? null) : null);
    setBusy(false);
    setFailed(false);
  }, [text, uiLanguage, localized]);

  if (uiLanguage !== 'zh' || localized) {
    return (
      <span className={className}>
        <DataswornText text={text} />
      </span>
    );
  }

  const runTranslate = async (): Promise<void> => {
    setFailed(false);
    setBusy(true);
    try {
      const translated = await translateText(config, text, 'zh');
      storeTranslation('zh', text, translated);
      setShown(translated);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={className}>
      <DataswornText text={shown ?? text} />
      <button
        type="button"
        className="ghost translate-btn"
        disabled={!configured || busy}
        title={!configured ? t('translate.needConfig') : undefined}
        onClick={() => {
          if (shown) {
            setShown(null);
            setFailed(false);
          } else {
            void runTranslate();
          }
        }}
      >
        {busy ? t('translate.busy') : shown ? t('translate.revert') : t('translate.button')}
      </button>
      {failed && <span className="hint">{t('translate.failed')}</span>}
    </span>
  );
}

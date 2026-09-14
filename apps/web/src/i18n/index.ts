import i18next, { type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en.js';
import { zh } from './zh.js';
import { useSettings } from '../stores/settings.js';

export type UiLanguage = 'en' | 'zh';

/** the language AI translations of game data are rendered into */
export function translationTargetLang(): UiLanguage {
  return useSettings.getState().settings.uiLanguage;
}

export const i18n: I18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: useSettings.getState().settings.uiLanguage,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

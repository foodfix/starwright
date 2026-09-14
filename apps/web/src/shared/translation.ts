const CACHE_KEY = 'starwright.translations.v1';
const MAX_ENTRIES = 300;

type TranslationCache = Record<string, string>;

/** cache key = `<target lang>:<djb2(text)>:<length>` (length guards hash collisions) */
function cacheKey(lang: string, text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `${lang}:${hash}:${text.length}`;
}

function readCache(): TranslationCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as TranslationCache;
    }
    return {};
  } catch {
    return {};
  }
}

function writeCache(cache: TranslationCache): void {
  try {
    const keys = Object.keys(cache);
    if (keys.length > MAX_ENTRIES) {
      for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) {
        delete cache[key];
      }
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable: translations stay in memory for this page only
  }
}

export function cachedTranslation(lang: string, text: string): string | undefined {
  return readCache()[cacheKey(lang, text)];
}

export function storeTranslation(lang: string, text: string, translation: string): void {
  const cache = readCache();
  cache[cacheKey(lang, text)] = translation;
  writeCache(cache);
}

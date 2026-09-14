import type { LlmDiagnostic } from '@starwright/ai';

/** diagnostic codes with a human-readable bilingual hint (i18n key `diag.<code>`) */
const KNOWN_CODES: ReadonlySet<string> = new Set([
  'auth_failed',
  'not_found',
  'rate_limited',
  'network_error',
  'no_function_calling',
  'malformed_response',
  'http_error',
]);

/** i18n key for a diagnostic; unknown codes fall back to the raw provider message */
export function diagnosticKey(code: string): string | null {
  return KNOWN_CODES.has(code) ? `diag.${code}` : null;
}

/** user-facing message for a diagnostic: readable hint when known, raw text otherwise */
export function diagnosticText(
  diagnostic: LlmDiagnostic,
  translate: (key: string) => string,
): string {
  const key = diagnosticKey(diagnostic.code);
  return key ? translate(key) : diagnostic.message;
}

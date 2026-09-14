/**
 * Tool-argument parsing and normalization (ai-design §3.4).
 *
 * OpenAI-compatible endpoints differ in how they serialize
 * `function.arguments`. Besides standard JSON, GLM/Qwen-style gateways emit
 * `<arg_key>k</arg_key><arg_value>v</arg_value>` tag sequences or
 * `{"arg_key": ..., "arg_value": ...}` repeated-key JSON — which loses the
 * keys under a plain JSON.parse. parseToolArguments restores standard
 * key/value objects for all three shapes; anything else surfaces as
 * `invalid_json` so the model can self-correct.
 */

export interface ParsedToolArgs {
  [key: string]: unknown;
}

export interface ArgsError {
  code: string;
  message: string;
  hint?: string;
}

const TAG_PAIR_RE = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
const JSON_KEY_RE = /"arg_key"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** read one balanced JSON value (string/object/array/literal) starting at `start` */
function readJsonValue(s: string, start: number): { value: unknown; end: number } | undefined {
  let i = start;
  while (i < s.length && /\s/.test(s[i] as string)) i += 1;
  const c = s[i];
  if (c === undefined) return undefined;
  if (c === '"') {
    let j = i + 1;
    while (j < s.length) {
      if (s[j] === '\\') {
        j += 2;
        continue;
      }
      if (s[j] === '"') break;
      j += 1;
    }
    const slice = s.slice(i, j + 1);
    const parsed = tryParseJson(slice);
    return { value: parsed.ok ? parsed.value : slice, end: j + 1 };
  }
  if (c === '{' || c === '[') {
    const close = c === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    let j = i;
    while (j < s.length) {
      const ch = s[j] as string;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === c) {
        depth += 1;
      } else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          j += 1;
          break;
        }
      }
      j += 1;
    }
    const slice = s.slice(i, j);
    const parsed = tryParseJson(slice);
    return parsed.ok ? { value: parsed.value, end: j } : undefined;
  }
  let j = i;
  while (j < s.length && !/[,\]}]/.test(s[j] as string) && s[j] !== '<') j += 1;
  const slice = s.slice(i, j).trim();
  if (slice.length === 0) return undefined;
  const parsed = tryParseJson(slice);
  return { value: parsed.ok ? parsed.value : slice, end: j };
}

/** `<arg_key>k</arg_key><arg_value>v</arg_value>` sequences (possibly wrapped) */
function pairsFromTagged(raw: string): ParsedToolArgs | undefined {
  TAG_PAIR_RE.lastIndex = 0;
  const out: ParsedToolArgs = {};
  let found = false;
  for (const match of raw.matchAll(TAG_PAIR_RE)) {
    const key = (match[1] ?? '').trim();
    const valueRaw = (match[2] ?? '').trim();
    if (key.length === 0) continue;
    const parsed = tryParseJson(valueRaw);
    out[key] = parsed.ok ? parsed.value : valueRaw;
    found = true;
  }
  return found ? out : undefined;
}

/** `{"arg_key": "k", "arg_value": v, "arg_key": "k2", ...}` repeated-key JSON */
function pairsFromJsonNamed(raw: string): ParsedToolArgs | undefined {
  JSON_KEY_RE.lastIndex = 0;
  const out: ParsedToolArgs = {};
  let found = false;
  for (const match of raw.matchAll(JSON_KEY_RE)) {
    const keyMatch = tryParseJson(`"${match[1] ?? ''}"`);
    if (!keyMatch.ok || typeof keyMatch.value !== 'string') continue;
    const rest = raw.slice((match.index ?? 0) + match[0].length);
    const valueMarker = /"arg_value"\s*:/.exec(rest);
    if (!valueMarker) continue;
    if (/[^\s,]/.test(rest.slice(0, valueMarker.index))) continue;
    const value = readJsonValue(
      raw,
      (match.index ?? 0) + match[0].length + valueMarker.index + valueMarker[0].length,
    );
    if (!value) continue;
    out[keyMatch.value] = value.value;
    found = true;
  }
  return found ? out : undefined;
}

export function parseToolArguments(raw: string): ParsedToolArgs | ArgsError {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return {};
  if (/<arg_key>/i.test(trimmed)) {
    const pairs = pairsFromTagged(trimmed);
    if (pairs) return pairs;
  }
  if (/"arg_key"/.test(trimmed)) {
    const pairs = pairsFromJsonNamed(trimmed);
    if (pairs) return pairs;
  }
  const parsed = tryParseJson(trimmed);
  if (
    parsed.ok &&
    typeof parsed.value === 'object' &&
    parsed.value !== null &&
    !Array.isArray(parsed.value)
  ) {
    return parsed.value as ParsedToolArgs;
  }
  let detail: string;
  if (parsed.ok) {
    detail = 'parsed value is not a JSON object';
  } else {
    try {
      JSON.parse(trimmed);
      detail = 'parsed value is not a JSON object';
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e);
    }
  }
  return {
    code: 'invalid_json',
    message: `tool arguments are not valid JSON: ${detail}`,
    hint: 'arguments must be a JSON object, e.g. {"move_id":"starforged/moves/adventure/face_danger","stat":"wits"}',
  };
}

export interface ChoiceOption {
  /** option text without the trailing move tag */
  text: string;
  /** trailing bracket tag: a move name (e.g. "Face Danger") or the story marker */
  tag?: string;
}

export interface SplitChoices {
  /** narration with the choices block removed (block hidden while streaming) */
  body: string;
  /** options extracted from the numbered lines (empty when none found) */
  choices: ChoiceOption[];
  /** true when a <choices> block was found and removed from body */
  present: boolean;
}

const OPEN = '<choices>';
const CLOSE = '</choices>';
const OPTION_LINE = /^\s*\d+\s*[.、)）．]\s*(.+?)\s*$/;
const COMPLETE_BLOCK = /<choices>[\s\S]*?<\/choices>/g;
/** trailing bracketed tag at end of line: half-width [Face Danger] or full-width 【剧情】 */
const TRAILING_TAG = /\s*[\[【]([^\]】]{1,40})[\]】]\s*$/;

/**
 * CYOA protocol: when enabled, the GM closes every turn's narration with a
 * `<choices>…</choices>` block of five numbered options, each ending with a
 * bracketed tag naming the move it would trigger or the story marker. The
 * block is part of the assistant text (persisted and replayed to the model
 * verbatim); the UI strips it from the prose and renders the options as
 * buttons, tag as a badge, sending the clean text on click. An unterminated
 * block (still streaming) is hidden from the marker onwards; a complete block
 * without parseable option lines is kept visible verbatim (graceful decay).
 */
export function splitChoices(text: string): SplitChoices {
  const open = text.lastIndexOf(OPEN);
  if (open === -1) return { body: text, choices: [], present: false };
  const close = text.indexOf(CLOSE, open + OPEN.length);
  if (close === -1) {
    return { body: text.slice(0, open).trimEnd(), choices: [], present: true };
  }
  const choices = parseOptionLines(text.slice(open + OPEN.length, close));
  if (choices.length === 0) {
    return { body: text, choices: [], present: false };
  }
  // only the latest block is current; any earlier complete blocks are stale
  const before = text.slice(0, open).replace(COMPLETE_BLOCK, '');
  const after = text.slice(close + CLOSE.length);
  const body = `${before.trimEnd()}\n\n${after.trimStart()}`.trim();
  return { body, choices, present: true };
}

function parseOptionLines(inner: string): ChoiceOption[] {
  const options: ChoiceOption[] = [];
  for (const line of inner.split('\n')) {
    const match = OPTION_LINE.exec(line);
    const raw = match?.[1];
    if (!raw) continue;
    options.push(splitTag(raw));
  }
  return options;
}

/** split a trailing bracket tag off the option line (only at end of line) */
function splitTag(raw: string): ChoiceOption {
  const match = TRAILING_TAG.exec(raw);
  if (!match?.[1]) return { text: raw };
  return { text: raw.slice(0, match.index).trimEnd(), tag: match[1] };
}

/** minimal structural shape of the data index the tag resolver needs */
export interface MoveCatalogSource {
  listMoves(): ReadonlyArray<{
    name: string;
    moves: ReadonlyArray<{ id: string; name: string }>;
  }>;
}

const STORY_TAGS = new Set(['story', '剧情']);

/** true when the tag is the pure-story marker (either narrative language) */
export function isStoryTag(tag: string): boolean {
  return STORY_TAGS.has(tag.trim().toLowerCase());
}

/**
 * Resolve an English move-name tag to its catalog entry (id + localized
 * name of the loaded data pack; en names match exactly, zh needs the id
 * slug — move ids keep the English snake_case name as their last segment).
 * Exact (localized) name wins, then the first id-slug match in catalog
 * order (plain Face Danger beats the scene-challenge variant).
 */
export function resolveMove(
  index: MoveCatalogSource,
  tag: string,
): { id: string; name: string } | undefined {
  const needle = tag.replace(/\s*\([^)]*\)\s*/g, '').trim();
  const slug = needle.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  let bySlug: { id: string; name: string } | undefined;
  for (const category of index.listMoves()) {
    for (const move of category.moves) {
      if (move.name === needle) return { id: move.id, name: move.name };
      if (bySlug === undefined && move.id.split('/').pop() === slug) {
        bySlug = { id: move.id, name: move.name };
      }
    }
  }
  return bySlug;
}

/** localized move name for a tag (see resolveMove) */
export function resolveMoveName(index: MoveCatalogSource, tag: string): string | undefined {
  return resolveMove(index, tag)?.name;
}

/** minimal shape of chat entries the selector needs (structural, testable) */
export interface ChoicesSource {
  kind: string;
  text?: string;
  streaming?: boolean;
}

/**
 * Choice buttons belong to the latest settled GM message. A turn appends
 * mechanics settlement strips (and possibly info notes) after the assistant
 * text, so the array's last entry is usually not the narration itself; scan
 * backwards, skip those trailers, and only accept a settled assistant text.
 */
export function latestChoices(entries: readonly ChoicesSource[]): ChoiceOption[] {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry) break;
    if (entry.kind === 'mechanics' || entry.kind === 'info') continue;
    if (entry.kind === 'assistant' && entry.streaming !== true && typeof entry.text === 'string') {
      return splitChoices(entry.text).choices;
    }
    break;
  }
  return [];
}

export interface SplitSummary {
  /** narration with the summary block removed (block hidden while streaming) */
  body: string;
  /** one-line recap extracted from the <summary> block (empty when none found) */
  summary: string;
  /** true when a <summary> block was found (complete or still streaming) */
  present: boolean;
}

const OPEN = '<summary>';
const CLOSE = '</summary>';
const COMPLETE_BLOCK = /<summary>[\s\S]*?<\/summary>/g;

/**
 * Turn recap protocol: the GM closes every turn's narration with a
 * `<summary>…</summary>` block holding a one-sentence recap (before any
 * <choices> block). The block is part of the assistant text (persisted and
 * replayed to the model verbatim); the UI strips it from the prose and shows
 * it as the turn's caption. An unterminated block (still streaming) is hidden
 * from the marker onwards; an empty block is ignored (graceful decay).
 */
export function splitSummary(text: string): SplitSummary {
  const open = text.lastIndexOf(OPEN);
  if (open === -1) return { body: text, summary: '', present: false };
  const close = text.indexOf(CLOSE, open + OPEN.length);
  if (close === -1) {
    return { body: text.slice(0, open).trimEnd(), summary: '', present: true };
  }
  const summary = text.slice(open + OPEN.length, close).replace(/\s+/g, ' ').trim();
  if (summary.length === 0) {
    return { body: text, summary: '', present: false };
  }
  // earlier complete blocks are stale; only the latest one is current
  const before = text.slice(0, open).replace(COMPLETE_BLOCK, '');
  const after = text.slice(close + CLOSE.length);
  const body = `${before.trimEnd()}\n\n${after.trimStart()}`.trim();
  return { body, summary, present: true };
}

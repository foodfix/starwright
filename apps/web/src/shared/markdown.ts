export type InlineSegment =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type MdBlock =
  | { type: 'p'; text: string }
  | { type: 'h'; level: number; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'quote'; text: string };

const INLINE_PATTERN =
  /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** inline markdown: code, bold (** and __), italic (*), http(s) links */
export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: 'text', text: text.slice(last, index) });
    if (match[1] !== undefined) segments.push({ kind: 'code', text: match[1] });
    else if (match[2] !== undefined) segments.push({ kind: 'strong', text: match[2] });
    else if (match[3] !== undefined) segments.push({ kind: 'strong', text: match[3] });
    else if (match[4] !== undefined) segments.push({ kind: 'em', text: match[4] });
    else segments.push({ kind: 'link', text: match[5] ?? '', href: match[6] ?? '' });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

/**
 * Block-level subset of markdown used by GM narration: paragraphs, ATX
 * headings, unordered lists and block quotes. Soft line breaks inside a
 * paragraph are preserved (the CSS keeps white-space).
 */
export function parseMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];

  const flush = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'p', text: paragraph.join('\n') });
      paragraph = [];
    }
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (line.trim().length === 0) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ type: 'h', level: heading[1]?.length ?? 1, text: heading[2] ?? '' });
    } else if (bullet) {
      flush();
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock?.type === 'ul') lastBlock.items.push(bullet[1] ?? '');
      else blocks.push({ type: 'ul', items: [bullet[1] ?? ''] });
    } else if (quote) {
      flush();
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock?.type === 'quote') lastBlock.text += `\n${quote[1] ?? ''}`;
      else blocks.push({ type: 'quote', text: quote[1] ?? '' });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

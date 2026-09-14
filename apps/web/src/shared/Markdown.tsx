import type { ReactNode } from 'react';
import { parseInline, parseMarkdown } from './markdown.js';

function renderInline(text: string): ReactNode {
  return parseInline(text).map((segment, i) => {
    switch (segment.kind) {
      case 'strong':
        return <strong key={i}>{segment.text}</strong>;
      case 'em':
        return <em key={i}>{segment.text}</em>;
      case 'code':
        return <code key={i}>{segment.text}</code>;
      case 'link':
        return (
          <a key={i} href={segment.href} target="_blank" rel="noreferrer">
            {segment.text}
          </a>
        );
      default:
        return segment.text;
    }
  });
}

/** Render GM narration markdown (subset: emphasis, code, lists, headings, quotes). */
export function Markdown({ text }: { text: string }): ReactNode {
  return parseMarkdown(text).map((block, i) => {
    switch (block.type) {
      case 'h': {
        if (block.level <= 1) return <h4 key={i}>{renderInline(block.text)}</h4>;
        if (block.level === 2) return <h5 key={i}>{renderInline(block.text)}</h5>;
        return <h6 key={i}>{renderInline(block.text)}</h6>;
      }
      case 'ul':
        return (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ul>
        );
      case 'quote':
        return <blockquote key={i}>{renderInline(block.text)}</blockquote>;
      default:
        return <p key={i}>{renderInline(block.text)}</p>;
    }
  });
}

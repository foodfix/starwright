import type { ReactNode } from 'react';
import { useCampaign } from '../stores/campaign.js';
import { describeDataswornNodeMarkdown, parseDatasworn } from './datasworn.js';
import { FloatingTip } from './FloatingTip.js';
import { Markdown } from './Markdown.js';

export interface DataswornTextProps {
  text: string;
  /** render a `{{table:id}}` segment (e.g. as an interactive picker); omit to hide it */
  renderTable?: (id: string) => ReactNode;
}

/** Render Datasworn rich text (`__bold__`, `[label](id:node)`, `{{table:id}}`) for the UI. */
export function DataswornText({ text, renderTable }: DataswornTextProps): ReactNode {
  const index = useCampaign((s) => s.index);
  return parseDatasworn(text).map((segment, i) => {
    if (segment.kind === 'strong') {
      return <strong key={i}>{segment.text}</strong>;
    }
    if (segment.kind === 'link') {
      const node = segment.id ? index?.byId.get(segment.id) : undefined;
      return (
        <FloatingTip
          key={i}
          className="ds-tip"
          placement="bottom"
          interactive
          content={node ? <Markdown text={describeDataswornNodeMarkdown(node)} /> : null}
        >
          <em className="ds-link" title={node ? undefined : segment.id}>
            {segment.text}
          </em>
        </FloatingTip>
      );
    }
    if (segment.kind === 'table') {
      return renderTable && segment.id ? <span key={i}>{renderTable(segment.id)}</span> : null;
    }
    return segment.text;
  });
}

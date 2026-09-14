import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useChat } from '../../stores/chat.js';
import { useCampaign } from '../../stores/campaign.js';
import { useSettings } from '../../stores/settings.js';
import { ErrorBoundary } from '../../shared/ErrorBoundary.js';
import { Markdown } from '../../shared/Markdown.js';
import { MechanicsStrip } from './SettlementCard.js';
import { splitChoices, latestChoices, isStoryTag, resolveMove } from './cyoa.js';
import { splitSummary } from './summary.js';
import { InteractionPopup } from './InteractionPopup.js';
import { FloatingTip } from '../../shared/FloatingTip.js';
import { describeDataswornNodeMarkdown } from '../../shared/datasworn.js';

export function NarrativeView() {
  const { t } = useTranslation();
  const { entries, busy, send, stop } = useChat();
  const interactions = useChat((s) => s.interactions);
  const anchorId = useChat((s) => s.interactionAnchorId);
  const cyoaEnabled = useSettings((s) => s.settings.cyoa);
  const dataIndex = useCampaign((s) => s.index);
  const [input, setInput] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [llmOpen, setLlmOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // a new turn re-anchors the audit records; close any open pop-up from the old one
  useEffect(() => {
    setLlmOpen(false);
  }, [anchorId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries, busy]);

  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const submit = (): void => {
    const text = input.trim();
    if (text.length === 0 || busy) return;
    setInput('');
    void send(text);
  };

  // CYOA buttons apply to the latest GM message only, once the turn is idle
  const choices = cyoaEnabled && !busy ? latestChoices(entries) : [];

  // tag badge: localize the story marker via i18n and move names via the
  // loaded data pack (hovering a resolved move badge shows its rules text);
  // fall back to the raw tag when either lookup misses
  const tagLabel = (tag: string): string => {
    if (isStoryTag(tag)) return t('narrative.storyTag');
    return (dataIndex && resolveMove(dataIndex, tag)?.name) || tag;
  };
  const moveNode = (tag: string) => {
    if (isStoryTag(tag) || !dataIndex) return undefined;
    const id = resolveMove(dataIndex, tag)?.id;
    return id ? dataIndex.byId.get(id) : undefined;
  };

  return (
    <section className="narrative" aria-label={t('narrative.title')}>
      <div className="stream">
        {entries.length === 0 && <p className="hint">{t('narrative.emptyHint')}</p>}
        {entries.map((entry) => (
          <ErrorBoundary key={entry.id} label={`a ${entry.kind} entry`}>
            {renderEntry(entry, t)}
            {entry.kind === 'assistant' && entry.id === anchorId && interactions.length > 0 && (
              <button
                type="button"
                className="llm-toggle"
                aria-expanded={llmOpen}
                onClick={() => setLlmOpen(true)}
              >
                {t('narrative.llmToggle', { count: interactions.length })}
              </button>
            )}
          </ErrorBoundary>
        ))}
        {choices.length > 0 && (
          <div className="cyoa" aria-label={t('narrative.choices')}>
            <p className="cyoa-label">{t('narrative.choices')}</p>
            {choices.map((choice, index) => {
              const node = choice.tag ? moveNode(choice.tag) : undefined;
              const badge = (
                <span className="cyoa-tag" title={node ? undefined : choice.tag}>
                  {choice.tag ? tagLabel(choice.tag) : null}
                </span>
              );
              return (
                <button
                  key={index}
                  type="button"
                  className="cyoa-choice"
                  onClick={() => void send(choice.text)}
                >
                  <span className="cyoa-num">{index + 1}</span>
                  {choice.text}
                  {choice.tag &&
                    (node ? (
                      <FloatingTip
                        className="ds-tip"
                        placement="bottom"
                        interactive
                        content={<Markdown text={describeDataswornNodeMarkdown(node)} />}
                      >
                        {badge}
                      </FloatingTip>
                    ) : (
                      badge
                    ))}
                </button>
              );
            })}
          </div>
        )}
        {busy && (
          <div className="thinking" aria-live="polite" aria-label={t('narrative.thinking')}>
            <span className="thinking-dots">
              <i />
              <i />
              <i />
            </span>
            <span>
              {elapsed >= 3
                ? t('narrative.thinkingWithElapsed', { seconds: elapsed })
                : t('narrative.thinking')}
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {llmOpen && (
        <InteractionPopup interactions={interactions} onClose={() => setLlmOpen(false)} />
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={input}
          rows={2}
          placeholder={busy ? t('narrative.placeholderBusy') : t('narrative.placeholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={busy}
        />
        <button type="submit" disabled={busy || input.trim().length === 0}>
          {t('narrative.send')}
        </button>
        {busy && (
          <button type="button" className="ghost" onClick={stop}>
            {t('narrative.stop')}
          </button>
        )}
      </form>
    </section>
  );
}

function renderEntry(entry: ReturnType<typeof useChat.getState>['entries'][number], t: TFunction) {
  switch (entry.kind) {
    case 'user':
      return <p className="msg user">{entry.text}</p>;
    case 'assistant': {
      // strip the CYOA choices and the one-line recap summary blocks from the
      // prose (choices render as buttons above, summary as the caption below)
      const { body: withoutChoices } = splitChoices(entry.text);
      const { body, summary } = splitSummary(withoutChoices);
      return (
        <div className="msg gm">
          <Markdown text={body} />
          {summary && (
            <p className="recap">
              {t('narrative.recap')} {summary}
            </p>
          )}
          {entry.streaming && <span className="cursor">▍</span>}
        </div>
      );
    }
    case 'mechanics':
      return <MechanicsStrip records={entry.records} />;
    case 'error':
      return <p className="msg error">{entry.message}</p>;
    case 'info':
      return <p className="msg info">{entry.message}</p>;
    case 'opening':
      return (
        <details className="opening-brief">
          <summary>{t('narrative.openingSummary')}</summary>
          <p className="rule-text">{entry.text}</p>
        </details>
      );
  }
}

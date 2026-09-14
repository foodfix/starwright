import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TurnInteraction } from '@starwright/ai';

function InteractionItem({ interaction }: { interaction: TurnInteraction }) {
  const { t } = useTranslation();
  const request = {
    messages: interaction.messages,
    ...(interaction.tools ? { tools: interaction.tools } : {}),
  };
  return (
    <details className="tool-item">
      <summary>
        <span className="tool-seq">#{interaction.round + 1}</span>
        <span>{t('inspector.round', { round: interaction.round + 1 })}</span>
        {interaction.reasoning.length > 0 && (
          <span className="tool-status ok">{t('inspector.reasoningTag')}</span>
        )}
        {interaction.toolCalls.length > 0 && (
          <span className="tool-status">
            {t('inspector.toolCallsTag', { count: interaction.toolCalls.length })}
          </span>
        )}
        {interaction.error && <span className="tool-status fail">{interaction.error.code}</span>}
      </summary>
      {interaction.reasoning.length > 0 && (
        <pre className="tool-detail reasoning">{`${t('inspector.reasoning')} ${interaction.reasoning}`}</pre>
      )}
      <pre className="tool-detail">{`${t('inspector.request')} ${JSON.stringify(request, null, 2)}`}</pre>
      {interaction.content.length > 0 && (
        <pre className="tool-detail">{`${t('inspector.response')} ${interaction.content}`}</pre>
      )}
    </details>
  );
}

/** pop-up window listing the latest turn's LLM interactions, opened from the
 * toggle hanging under the GM reply in the narrative stream */
export function InteractionPopup({
  interactions,
  onClose,
}: {
  interactions: TurnInteraction[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="llm-popup-overlay" onClick={onClose}>
      <section
        className="llm-popup"
        role="dialog"
        aria-modal="true"
        aria-label={t('inspector.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="llm-popup-head">
          <h2>{t('inspector.title')}</h2>
          <button type="button" className="ghost" onClick={onClose}>
            {t('inspector.close')}
          </button>
        </header>
        <div className="llm-popup-body">
          {[...interactions].reverse().map((interaction) => (
            <InteractionItem key={interaction.round} interaction={interaction} />
          ))}
        </div>
      </section>
    </div>
  );
}

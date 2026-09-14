import { useTranslation } from 'react-i18next';
import type { TurnToolRecord } from '@starwright/ai';

function ToolLogItem({ record }: { record: TurnToolRecord }) {
  const { t } = useTranslation();
  const ok = record.execution.ok;
  return (
    <details className={ok ? 'tool-item' : 'tool-item failed'}>
      <summary>
        <span className="tool-seq">#{record.seq}</span> <code>{record.name}</code>
        <span className={ok ? 'tool-status ok' : 'tool-status fail'}>
          {ok ? t('toollog.ok') : t('toollog.error')}
        </span>
      </summary>
      <pre className="tool-detail">{`${t('toollog.args')} ${JSON.stringify(record.args, null, 2) ?? '—'}`}</pre>
      <pre className="tool-detail">{`${t('toollog.result')} ${record.content}`}</pre>
    </details>
  );
}

export function ToolLogPanel({ records }: { records: TurnToolRecord[] }) {
  const { t } = useTranslation();
  return (
    <section className="gm-panel" aria-label={t('toollog.title')}>
      <h2>{t('toollog.title')}</h2>
      {records.length === 0 ? (
        <p className="track-meta">{t('toollog.empty')}</p>
      ) : (
        <div className="tool-list">
          {[...records].reverse().map((record) => (
            <ToolLogItem key={`${record.seq}-${record.name}`} record={record} />
          ))}
        </div>
      )}
    </section>
  );
}

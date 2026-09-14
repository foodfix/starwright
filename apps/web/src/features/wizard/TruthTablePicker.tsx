import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { StarforgedIndex } from '@starwright/data';
import { rollTruthTableRow } from './truthTable.js';

export interface TruthTablePickerProps {
  index: StarforgedIndex;
  tableId: string;
  value: string;
  onChange: (text: string) => void;
}

export function TruthTablePicker({
  index,
  tableId,
  value,
  onChange,
}: TruthTablePickerProps): React.ReactNode {
  const { t } = useTranslation();
  const rows = useMemo(() => index.getOracleRows(tableId) ?? [], [index, tableId]);
  return (
    <span className="truth-table">
      <select
        value={value}
        aria-label={t('wizard.truthTableLabel')}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t('wizard.truthTablePlaceholder')}</option>
        {rows.map((row, i) => (
          <option key={i} value={row.text}>
            {row.text}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="truth-table-roll"
        title={t('wizard.truthTableRandom')}
        aria-label={t('wizard.truthTableRandom')}
        onClick={() => {
          const row = rollTruthTableRow(rows, Math.random);
          if (row) onChange(row.text);
        }}
      >
        🎲
      </button>
    </span>
  );
}

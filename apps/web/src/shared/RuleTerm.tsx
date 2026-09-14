import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { FloatingTip } from './FloatingTip.js';

export type TermKind = 'stat' | 'meter' | 'impact' | 'legacy' | 'trackKind' | 'rollType';

/** localized label for a rule term id; falls back to the raw id when the glossary has no entry */
export function ruleTermLabel(t: TFunction, kind: TermKind, id: string): string {
  const key = `term.${kind}.${id}.label`;
  const label = t(key);
  return label === key ? id : label;
}

/**
 * Rule term (stat/meter/impact/legacy/track kind/roll type) rendered as a
 * localized label with a hover glossary tooltip shown above the term
 * (English term + rules description, useful for zh players to match the
 * original rulebook wording). Untranslated ids render as the raw id without
 * a tooltip.
 */
export function RuleTerm({ kind, id }: { kind: TermKind; id: string }): ReactNode {
  const { t } = useTranslation();
  const labelKey = `term.${kind}.${id}.label`;
  const descKey = `term.${kind}.${id}.desc`;
  const label = t(labelKey);
  if (label === labelKey) {
    return <span className="term">{id}</span>;
  }
  const desc = t(descKey);
  if (desc === descKey) {
    return <span className="term">{label}</span>;
  }
  return (
    <FloatingTip
      className="term-tip"
      placement="top"
      content={
        <>
          <strong>{id.replace(/_/g, ' ')}</strong>
          {' — '}
          {desc}
        </>
      }
    >
      <span className="term">{label}</span>
    </FloatingTip>
  );
}

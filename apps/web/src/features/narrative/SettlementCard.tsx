import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { ActionRollOutcome, EngineOutcome } from '@starwright/engine';
import type { TurnToolRecord } from '@starwright/ai';
import { DataswornText } from '../../shared/DataswornText.js';
import { RuleTerm, ruleTermLabel } from '../../shared/RuleTerm.js';
import { Translatable } from '../../shared/Translatable.js';
import { useCampaign } from '../../stores/campaign.js';
import { flagDetail, flagSummary } from './flagSummary.js';
import { scoreBreakdown } from './scoreBreakdown.js';

interface SpecialRoll {
  legacy: string;
  outcomeKind: string;
}

interface OracleRollSummary {
  tableId: string;
  roll: number;
  text: string;
}

interface MakeMovePayload {
  move: { id: string; name: string; roll_type: string };
  outcomeKind?: 'strong_hit' | 'weak_hit' | 'miss';
  engineOutcome?: EngineOutcome;
  rolls?: SpecialRoll[];
  text?: string;
  note?: string;
  selection?: string;
  oracleRolls?: OracleRollSummary[];
  oracleCandidates?: string[];
}

interface OraclePayload {
  tableId: string;
  roll: number;
  match: boolean;
  text: string;
  suggestion?: string;
}

interface MoveDetailPayload {
  id: string;
  name: string;
  roll_type: string;
  trigger?: { text?: string } | null;
  text?: string | null;
  outcomes?: Record<string, { text: string }> | null;
  oracles?: string[];
}

interface OracleDetailPayload {
  id: string;
  name: string;
  rows: Array<{ min: number; max: number; text: string }>;
}

function isMakeMovePayload(payload: object): payload is MakeMovePayload {
  return 'move' in payload;
}

function isOraclePayload(payload: object): payload is OraclePayload {
  return 'tableId' in payload && 'roll' in payload;
}

function isMoveDetailPayload(payload: object): payload is MoveDetailPayload {
  return 'roll_type' in payload && 'name' in payload;
}

function isOracleDetailPayload(payload: object): payload is OracleDetailPayload {
  return 'rows' in payload && 'name' in payload;
}

const OUTCOME_KINDS = ['strong_hit', 'weak_hit', 'miss'] as const;

function OutcomeBadge({ kind, t }: { kind: string | undefined; t: TFunction }) {
  if (!kind || !OUTCOME_KINDS.includes(kind as (typeof OUTCOME_KINDS)[number])) return null;
  return <span className={`badge ${kind}`}>{t(`outcome.${kind}`)}</span>;
}

const lastSegment = (id: string): string => id.split('/').pop() ?? id;

/** one-line dice conclusion for the collapsed summary */
function diceSummary(outcome: EngineOutcome, t: TFunction): string | null {
  if (outcome.kind === 'action_roll') {
    const parts = [
      t('mechanics.summaryScoreVs', {
        score: outcome.score,
        challenge: outcome.dice.challenge.join('/'),
      }),
      outcome.canceledActionDie
        ? t('mechanics.summaryCanceled')
        : t('mechanics.summaryAction', { value: outcome.dice.actionDie }),
    ];
    return parts.join(' · ');
  }
  if (outcome.kind === 'progress_roll') {
    return t('mechanics.summaryProgress', {
      score: outcome.score,
      challenge: outcome.dice.challenge.join('/'),
    });
  }
  if (outcome.kind === 'burn_momentum') {
    return t('mechanics.summaryBurn', {
      outcome: outcomeLabel(outcome.result.outcome, t),
      score: outcome.result.score,
    });
  }
  return null;
}

function outcomeLabel(kind: string, t: TFunction): string {
  return OUTCOME_KINDS.includes(kind as (typeof OUTCOME_KINDS)[number])
    ? t(`outcome.${kind}`)
    : kind;
}

function rankLabel(rank: string | null | undefined, t: TFunction): string {
  if (!rank) return t('character.noRank');
  const key = `rank.${rank}`;
  const translated = t(key);
  return translated === key ? rank : translated;
}

/** compact note for plain event cards (flags, scenes, journal notes) */
function plainSummary(outcome: EngineOutcome, t: TFunction): string {
  switch (outcome.kind) {
    case 'end_scene':
      return t('mechanics.summaryScene', { index: outcome.sceneIndex });
    case 'set_aboard_vehicle':
      return outcome.assetIds.length > 0
        ? t('mechanics.summaryAboard', {
            list: outcome.assetIds.map(lastSegment).join(', '),
          })
        : t('mechanics.summaryAboardNone');
    default:
      return '';
  }
}

function countInteresting(records: TurnToolRecord[]): { rolls: number; failed: number } {
  let rolls = 0;
  let failed = 0;
  for (const record of records) {
    if (!record.execution.ok) {
      failed += 1;
      continue;
    }
    const payload = record.execution.payload as {
      oracleRolls?: unknown[];
      nestedOracleRolls?: unknown[];
    };
    if (record.name === 'roll_oracle') rolls += 1;
    if (payload && typeof payload === 'object' && 'move' in payload) {
      rolls += (payload.oracleRolls?.length ?? 0) + (payload.nestedOracleRolls?.length ?? 0);
    }
  }
  return { rolls, failed };
}

/** one collapsible strip for all tool settlements of a turn */
export function MechanicsStrip({ records }: { records: TurnToolRecord[] }) {
  const { t } = useTranslation();
  const { rolls, failed } = countInteresting(records);
  const bits = [t('mechanics.results', { count: records.length })];
  if (rolls > 0) bits.push(t('mechanics.rolls', { count: rolls }));
  return (
    <details className={`mechanics${failed > 0 ? ' has-failure' : ''}`}>
      <summary>
        <span className="mechanics-label">{t('mechanics.label')}</span>
        <span className="summary-line">{bits.join(' · ')}</span>
        {failed > 0 && <span className="badge miss">{t('mechanics.failedBadge')}</span>}
      </summary>
      <div className="details-body">
        {records.map((record) => (
          <SettlementCard key={record.seq} record={record} />
        ))}
      </div>
    </details>
  );
}

/** formula line showing where every point of the action score came from */
function ScoreBreakdownLine({ outcome, t }: { outcome: ActionRollOutcome; t: TFunction }) {
  const breakdown = scoreBreakdown(outcome);
  const terms = breakdown.terms.map((term) => {
    switch (term.kind) {
      case 'die':
        return t('mechanics.termDie', { value: term.value });
      case 'stat':
        return `${ruleTermLabel(t, 'stat', term.id)} ${term.value}`;
      case 'meter':
        return `${ruleTermLabel(t, 'meter', term.id)} ${term.value}`;
      case 'assetMeter':
        return t('mechanics.termAssetMeter', {
          asset: lastSegment(term.assetId),
          control: term.control,
          value: term.value,
        });
      case 'add':
        return t('mechanics.termAdd', { value: term.value });
      case 'burn':
        return t('mechanics.termBurn', { value: term.value });
    }
  });
  return (
    <div className="breakdown">
      {t('mechanics.scoreFormula', { terms: terms.join(' + '), score: breakdown.score })}
      {breakdown.raw !== undefined
        ? t('mechanics.clampNote', { raw: breakdown.raw, score: breakdown.score })
        : ''}
      {outcome.canceledActionDie ? t('mechanics.canceledNote') : ''}
    </div>
  );
}

function Dice({ outcome, t }: { outcome: EngineOutcome; t: TFunction }) {
  if (outcome.kind === 'action_roll') {
    const { actionDie, challenge } = outcome.dice;
    return (
      <>
        <div className="dice">
          <span className={outcome.canceledActionDie ? 'die canceled' : 'die'}>
            {outcome.canceledActionDie
              ? t('mechanics.dieActionCanceled', { value: actionDie })
              : t('mechanics.dieAction', { value: actionDie })}
          </span>
          <span className="die">
            {t('mechanics.dieChallenge', { a: challenge[0], b: challenge[1] })}
          </span>
          <span className="score">
            {t('mechanics.scoreLine', { score: outcome.score })}
            {outcome.burned ? t('mechanics.burnedSuffix') : ''}
            {outcome.match ? t('mechanics.matchSuffix') : ''}
          </span>
        </div>
        <ScoreBreakdownLine outcome={outcome} t={t} />
      </>
    );
  }
  if (outcome.kind === 'progress_roll') {
    return (
      <div className="dice">
        <span className="die">
          {t('mechanics.dieChallenge', {
            a: outcome.dice.challenge[0],
            b: outcome.dice.challenge[1],
          })}
        </span>
        <span className="score">{t('mechanics.progressScore', { score: outcome.score })}</span>
      </div>
    );
  }
  return null;
}

function MeterDelta({ outcome, t }: { outcome: EngineOutcome; t: TFunction }) {
  if (outcome.kind === 'adjust_meter') {
    return (
      <div className="delta">
        {t('delta.meter', {
          meter: ruleTermLabel(t, 'meter', outcome.meter),
          before: outcome.before,
          after: outcome.after,
          signedDelta: `${outcome.delta >= 0 ? '+' : ''}${outcome.delta}`,
        })}
      </div>
    );
  }
  if (outcome.kind === 'adjust_momentum') {
    return (
      <div className="delta">
        {t('delta.momentum', {
          before: outcome.before,
          after: outcome.after,
          max: outcome.momentumMax,
        })}
      </div>
    );
  }
  if (outcome.kind === 'burn_momentum') {
    return (
      <div className="delta">
        {t('delta.burn', {
          before: outcome.momentumBefore,
          after: outcome.momentumAfter,
          reset: outcome.reset,
          outcome: outcomeLabel(outcome.result.outcome, t),
          score: outcome.result.score,
        })}
      </div>
    );
  }
  if (outcome.kind === 'mark_impact' || outcome.kind === 'clear_impact') {
    return (
      <div className="delta">
        {t('delta.impacts', {
          list:
            outcome.impacts.map((impactId) => ruleTermLabel(t, 'impact', impactId)).join(', ') ||
            t('character.none'),
        })}
      </div>
    );
  }
  if (outcome.kind === 'add_track') {
    return (
      <div className="delta">
        {t('delta.newTrack', {
          id: outcome.trackId,
          title: outcome.title,
          rank: rankLabel(outcome.rank, t),
          kind: ruleTermLabel(t, 'trackKind', outcome.trackKind),
        })}
      </div>
    );
  }
  if (outcome.kind === 'mark_progress') {
    return (
      <div className="delta">
        {t('delta.ticks', { added: outcome.ticksAdded, total: outcome.ticks })}
      </div>
    );
  }
  if (outcome.kind === 'adjust_legacy') {
    return (
      <div className="delta">
        {t('delta.legacyTicks', {
          signedAdded: `${outcome.ticksAdded >= 0 ? '+' : ''}${outcome.ticksAdded}`,
          total: outcome.ticks,
        })}
        {outcome.cleared ? t('delta.clearedSuffix') : ''}
        {outcome.experienceGained > 0 ? t('delta.xpSuffix', { xp: outcome.experienceGained }) : ''}
      </div>
    );
  }
  if (outcome.kind === 'add_asset' || outcome.kind === 'discard_asset') {
    return (
      <div className="delta">
        {outcome.kind === 'add_asset'
          ? t('delta.gained', { name: outcome.asset.name, id: outcome.asset.instanceId })
          : t('delta.discarded', { name: outcome.asset.name, id: outcome.asset.instanceId })}
        {outcome.kind === 'add_asset' && outcome.experienceCost > 0
          ? t('delta.xpCostSuffix', { xp: outcome.experienceCost })
          : ''}
      </div>
    );
  }
  if (outcome.kind === 'enable_ability') {
    return (
      <div className="delta">
        {t('delta.ability', { index: outcome.abilityIndex, name: outcome.asset.name })}
        {outcome.experienceCost > 0 ? t('delta.xpCostSuffix', { xp: outcome.experienceCost }) : ''}
      </div>
    );
  }
  if (outcome.kind === 'adjust_asset_meter') {
    return (
      <div className="delta">
        {t('delta.assetMeter', {
          name: outcome.asset.name,
          control: outcome.control,
          before: outcome.before,
          after: outcome.after,
        })}
      </div>
    );
  }
  if (outcome.kind === 'set_asset_control') {
    return (
      <div className="delta">
        {outcome.value
          ? t('delta.assetControlMarked', { name: outcome.asset.name, control: outcome.control })
          : t('delta.assetControlCleared', { name: outcome.asset.name, control: outcome.control })}
      </div>
    );
  }
  if (outcome.kind === 'remove_track') {
    return (
      <div className="delta">
        {t('delta.removeTrack', { id: outcome.trackId, title: outcome.title })}
      </div>
    );
  }
  if (outcome.kind === 'update_track') {
    return (
      <div className="delta">
        {t('delta.updateTrack', { rank: rankLabel(outcome.rank, t) })}
        {outcome.ticksBefore !== undefined && outcome.ticksBefore !== outcome.ticks
          ? t('delta.updateTrackTicks', { before: outcome.ticksBefore, after: outcome.ticks })
          : ''}
      </div>
    );
  }
  return null;
}

function toolTitle(name: string, t: TFunction): string {
  const key = `tool.${name}`;
  const translated = t(key);
  // untranslated tool ids fall back to the raw id
  return translated === key ? name : translated;
}

export function SettlementCard({ record }: { record: TurnToolRecord }) {
  const { t } = useTranslation();
  const index = useCampaign((s) => s.index);
  // localized oracle table name (zh dataset ships Chinese names); falls back to the id tail
  const oracleName = (tableId: string): string =>
    index?.getOracle(tableId)?.name ?? lastSegment(tableId);
  if (!record.execution.ok) {
    const error = record.execution.error;
    return (
      <article className="settlement failure">
        <header>
          <strong>{toolTitle(record.name, t)}</strong>
          <span className="badge miss">{t('mechanics.failedBadge')}</span>
        </header>
        <p className="error-text">
          {error.code}: {error.message}
        </p>
      </article>
    );
  }
  const payload = record.execution.payload as object;
  if (isMakeMovePayload(payload)) {
    return (
      <details className="settlement move">
        <summary>
          <strong>{payload.move?.name ?? t('mechanics.moveFallback')}</strong>
          <OutcomeBadge kind={payload.outcomeKind} t={t} />
          {payload.engineOutcome && (
            <span className="summary-line">{diceSummary(payload.engineOutcome, t)}</span>
          )}
        </summary>
        <div className="details-body">
          {payload.selection && (
            <p className="hint">{t('mechanics.rollSelection', { value: payload.selection })}</p>
          )}
          {payload.engineOutcome && <Dice outcome={payload.engineOutcome} t={t} />}
          {payload.engineOutcome && <MeterDelta outcome={payload.engineOutcome} t={t} />}
          {payload.rolls && payload.rolls.length > 0 && (
            <ul className="special-rolls">
              {payload.rolls.map((roll) => (
                <li key={roll.legacy}>
                  {ruleTermLabel(t, 'legacy', roll.legacy.replace('_legacy', ''))}:{' '}
                  <OutcomeBadge kind={roll.outcomeKind} t={t} />
                </li>
              ))}
            </ul>
          )}
          {payload.oracleRolls?.map((roll) => (
            <p key={roll.tableId} className="hint">
              {t('mechanics.oracleRollPrefix', {
                roll: roll.roll,
                table: oracleName(roll.tableId),
              })}
              <DataswornText text={roll.text} />
            </p>
          ))}
          {payload.oracleCandidates && payload.oracleCandidates.length > 0 && (
            <p className="hint">
              {t('mechanics.oracleOptions', { list: payload.oracleCandidates.join(', ') })}
            </p>
          )}
          {payload.text && (
            <p className="rule-text">
              <Translatable text={payload.text} />
            </p>
          )}
          {payload.note && <p className="hint">{payload.note}</p>}
        </div>
      </details>
    );
  }
  if (isOraclePayload(payload)) {
    return (
      <details className="settlement oracle">
        <summary>
          <span className="badge roll">
            {t('mechanics.d100', { roll: payload.roll })}
            {payload.match ? t('mechanics.matchSuffix') : ''}
          </span>
          <span className="summary-line">{oracleName(payload.tableId)}</span>
          <span className="summary-line grow">
            <DataswornText text={payload.text ?? ''} />
          </span>
        </summary>
        <div className="details-body">
          <p className="hint">{payload.tableId}</p>
          <p className="rule-text">
            <Translatable text={payload.text} />
          </p>
          {payload.suggestion && (
            <p className="hint">
              {t('mechanics.suggestion')} <Translatable text={payload.suggestion} />
            </p>
          )}
        </div>
      </details>
    );
  }
  if ('kind' in payload) {
    const outcome = payload as EngineOutcome;
    if (outcome.kind === 'set_flag') {
      return (
        <details className="settlement plain">
          <summary>
            <strong>{toolTitle(record.name, t)}</strong>
            <span className="summary-line grow">
              {outcome.key} = {flagSummary(outcome.value)}
            </span>
          </summary>
          <div className="details-body">
            <pre className="rule-text">{flagDetail(outcome.value)}</pre>
          </div>
        </details>
      );
    }
    if (outcome.kind === 'add_journal_entry') {
      const note = (payload as { text?: string }).text ?? '';
      const oneLine = note.replace(/\s+/g, ' ');
      return (
        <details className="settlement plain">
          <summary>
            <strong>{toolTitle(record.name, t)}</strong>
            <span className="summary-line grow">
              {oneLine.length > 96 ? `${oneLine.slice(0, 96)}…` : oneLine}
            </span>
          </summary>
          <div className="details-body">
            <p className="rule-text">{note}</p>
          </div>
        </details>
      );
    }
    return (
      <article className="settlement plain">
        <header>
          <strong>{toolTitle(record.name, t)}</strong>
          <MeterDelta outcome={outcome} t={t} />
          <span className="summary-line">{plainSummary(outcome, t)}</span>
        </header>
      </article>
    );
  }
  if (isOracleDetailPayload(payload)) {
    return (
      <details className="settlement plain">
        <summary>
          <strong>{toolTitle(record.name, t)}</strong>
          <span className="summary-line grow">
            {payload.id} — {payload.name} (
            {t('mechanics.rowsCount', { count: payload.rows.length })})
          </span>
        </summary>
        <div className="details-body">
          <ul className="oracle-rows">
            {payload.rows.map((row) => (
              <li key={row.min}>
                <span className="hint">
                  {row.min}–{row.max}
                </span>{' '}
                <Translatable text={row.text} />
              </li>
            ))}
          </ul>
        </div>
      </details>
    );
  }
  if (isMoveDetailPayload(payload)) {
    const outcomeEntries = Object.entries(payload.outcomes ?? {});
    return (
      <details className="settlement plain">
        <summary>
          <strong>{toolTitle(record.name, t)}</strong>
          <span className="summary-line grow">
            {payload.id} — {payload.name}
          </span>
        </summary>
        <div className="details-body">
          <p className="hint">
            <RuleTerm kind="rollType" id={payload.roll_type} />
          </p>
          {payload.trigger?.text && (
            <p className="hint">
              <Translatable text={payload.trigger.text} />
            </p>
          )}
          {payload.text && (
            <p className="rule-text">
              <Translatable text={payload.text} />
            </p>
          )}
          {outcomeEntries.map(([kind, outcome]) => (
            <p key={kind} className="rule-text">
              <Translatable text={outcome.text} />
            </p>
          ))}
          {payload.oracles && payload.oracles.length > 0 && (
            <p className="hint">
              {t('mechanics.oracleRefs', { list: payload.oracles.join(', ') })}
            </p>
          )}
        </div>
      </details>
    );
  }
  return (
    <article className="settlement plain">
      <header>
        <strong>{toolTitle(record.name, t)}</strong>
      </header>
      <p className="hint">{t('mechanics.done')}</p>
    </article>
  );
}

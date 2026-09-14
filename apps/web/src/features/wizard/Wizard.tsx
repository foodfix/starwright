import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { StarforgedIndex } from '@starwright/data';
import type { ChallengeRank } from '@starwright/engine';
import {
  CHALLENGE_RANKS,
  INITIAL_ASSET_COUNT,
  MAX_BACKGROUND_LENGTH,
  MAX_FLAG_LENGTH,
  MAX_FLAGS,
  STAT_IDS,
  STAT_POOL,
  STARSHIP_ASSET_ID,
  type StatId,
  type WizardInput,
} from '../../persistence/wizard.js';
import { DataswornText } from '../../shared/DataswornText.js';
import { RuleTerm, ruleTermLabel } from '../../shared/RuleTerm.js';
import { TruthTablePicker } from './TruthTablePicker.js';

export interface WizardProps {
  index: StarforgedIndex;
  onComplete: (raw: WizardInput) => void;
}

function rankLabel(rank: ChallengeRank | string, t: TFunction): string {
  const key = `rank.${rank}`;
  const translated = t(key);
  return translated === key ? String(rank) : translated;
}

function initialRaw(): WizardInput {
  const truths: Record<string, string> = {};
  return {
    characterName: '',
    background: '',
    truths,
    truthDetails: {},
    stats: { edge: 3, heart: 2, iron: 2, shadow: 1, wits: 1 },
    backgroundVow: null,
    assetIds: [],
    flags: [],
  };
}

const STEPS = ['stepsTruths', 'stepsCharacter', 'stepsFlags', 'stepsAssets', 'stepsBegin'] as const;

export function Wizard({ index, onComplete }: WizardProps) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(0);
  const [raw, setRaw] = useState<WizardInput>(initialRaw);
  const [assetFilter, setAssetFilter] = useState('');
  const [flagDraft, setFlagDraft] = useState('');
  const truths = useMemo(() => index.listTruths(), [index]);
  const assetTree = useMemo(() => index.listAssetTree(), [index]);
  const starship = index.getAsset(STARSHIP_ASSET_ID);

  // seed the default option ('0') of every truth so the visible preselection
  // matches state and the step is valid without clicking all 14 groups
  useEffect(() => {
    setRaw((prev) => {
      const truths: Record<string, string> = { ...prev.truths };
      let changed = false;
      for (const truth of index.listTruths()) {
        const key = truth._id.split('/').pop() ?? '';
        if (truths[key] === undefined) {
          truths[key] = '0';
          changed = true;
        }
      }
      return changed ? { ...prev, truths } : prev;
    });
  }, [index]);

  const patch = (partial: Partial<WizardInput>): void =>
    setRaw((prev) => ({ ...prev, ...partial }));

  const randomizeTruths = (): void => {
    const next: Record<string, string> = {};
    for (const truth of truths) {
      const key = truth._id.split('/').pop() ?? '';
      next[key] = String(Math.floor(Math.random() * truth.options.length));
    }
    patch({ truths: next });
  };

  const toggleAsset = (assetId: string): void => {
    const has = raw.assetIds.includes(assetId);
    const next = has
      ? raw.assetIds.filter((id) => id !== assetId)
      : raw.assetIds.length < INITIAL_ASSET_COUNT
        ? [...raw.assetIds, assetId]
        : raw.assetIds;
    patch({ assetIds: next });
  };

  const addFlag = (): void => {
    const trimmed = flagDraft.trim().slice(0, MAX_FLAG_LENGTH);
    if (trimmed.length === 0 || raw.flags.includes(trimmed) || raw.flags.length >= MAX_FLAGS) {
      setFlagDraft('');
      return;
    }
    patch({ flags: [...raw.flags, trimmed] });
    setFlagDraft('');
  };

  const removeFlag = (flag: string): void => {
    patch({ flags: raw.flags.filter((f) => f !== flag) });
  };

  const truthError = truths.some(
    (truth) => raw.truths[truth._id.split('/').pop() ?? ''] === undefined,
  );
  const statValues = Object.values(raw.stats);
  const statOk =
    [...statValues].sort((a, b) => a - b).join() === [...STAT_POOL].sort((a, b) => a - b).join();
  const assetsOk = raw.assetIds.length === INITIAL_ASSET_COUNT;
  const stepOk =
    [!truthError, raw.characterName.trim().length > 0 && statOk, true, assetsOk, true][step] ??
    false;

  const filteredTree = assetTree
    .map((category) => ({
      ...category,
      assets: category.assets.filter((asset) => {
        // the Starship ships with every campaign and cannot be picked again
        if (asset.id === STARSHIP_ASSET_ID) return false;
        const needle = assetFilter.trim().toLowerCase();
        if (needle.length === 0) return true;
        return (
          asset.name.toLowerCase().includes(needle) ||
          asset.category.toLowerCase().includes(needle) ||
          asset.firstAbility.toLowerCase().includes(needle)
        );
      }),
    }))
    // hide categories left empty by the filter (e.g. Command Vehicle)
    .filter((category) => category.assets.length > 0);

  const finish = (): void => onComplete(raw);

  return (
    <section className="wizard" aria-label={t('wizard.title')}>
      <header className="wizard-header">
        <h2>{t('wizard.title')}</h2>
        <ol className="wizard-steps">
          {STEPS.map((key, i) => (
            <li key={key} className={i === step ? 'active' : i < step ? 'done' : ''}>
              {i + 1}. {t(`wizard.${key}`)}
            </li>
          ))}
        </ol>
      </header>

      {step === 0 && (
        <div className="wizard-truths">
          <div className="truths-actions">
            <p className="hint">{t('wizard.truthsHint')}</p>
            <button type="button" className="ghost" onClick={randomizeTruths}>
              {t('wizard.truthsRandom')}
            </button>
          </div>
          {truths.map((truth) => {
            const key = truth._id.split('/').pop() ?? '';
            const chosen = raw.truths[key] ?? '0';
            return (
              <fieldset key={truth._id} className="truth">
                <legend>{truth.name}</legend>
                {truth.options.map((option, i) => (
                  <label key={i} className={String(i) === chosen ? 'option chosen' : 'option'}>
                    <input
                      type="radio"
                      name={truth._id}
                      value={i}
                      checked={String(i) === chosen}
                      onChange={() => patch({ truths: { ...raw.truths, [key]: String(i) } })}
                    />
                    <span className="option-body">
                      <strong>{option.summary}</strong>
                      <span className="option-desc">
                        <DataswornText
                          text={option.description}
                          renderTable={(tableId) => (
                            <TruthTablePicker
                              index={index}
                              tableId={tableId}
                              value={raw.truthDetails?.[tableId] ?? ''}
                              onChange={(text) =>
                                patch({
                                  truthDetails: { ...raw.truthDetails, [tableId]: text },
                                })
                              }
                            />
                          )}
                        />
                      </span>
                      <span className="option-starter">
                        {t('wizard.questStarter')} <DataswornText text={option.quest_starter} />
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
      )}

      {step === 1 && (
        <div className="wizard-character">
          <label className="field">
            <span>{t('wizard.characterName')}</span>
            <input
              type="text"
              value={raw.characterName}
              onChange={(e) => patch({ characterName: e.target.value })}
              placeholder={t('wizard.namePlaceholder')}
            />
          </label>
          <label className="field">
            <span>{t('wizard.backgroundLabel')}</span>
            <textarea
              value={raw.background}
              maxLength={MAX_BACKGROUND_LENGTH}
              rows={4}
              onChange={(e) => patch({ background: e.target.value })}
              placeholder={t('wizard.backgroundPlaceholder')}
            />
            <span className="hint">{t('wizard.backgroundHint')}</span>
          </label>
          <h3>{t('wizard.statsTitle', { pool: STAT_POOL.join(', ') })}</h3>
          <div className="stat-grid">
            {STAT_IDS.map((stat: StatId) => (
              <label key={stat} className="field">
                <span>
                  <RuleTerm kind="stat" id={stat} />
                </span>
                <select
                  value={raw.stats[stat]}
                  onChange={(e) =>
                    patch({ stats: { ...raw.stats, [stat]: Number(e.target.value) } })
                  }
                >
                  {[1, 2, 3].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {!statOk && (
            <p className="msg error">{t('wizard.statsError', { pool: STAT_POOL.join(', ') })}</p>
          )}
          <h3>{t('wizard.backgroundVow')}</h3>
          <p className="hint">{t('wizard.vowHint')}</p>
          <div className="field-row">
            <label className="field grow">
              <span>{t('wizard.vowLabel')}</span>
              <input
                type="text"
                value={raw.backgroundVow?.title ?? ''}
                onChange={(e) => {
                  const title = e.target.value;
                  patch({
                    backgroundVow:
                      title.trim().length === 0
                        ? null
                        : { title, rank: raw.backgroundVow?.rank ?? 'troublesome' },
                  });
                }}
                placeholder={t('wizard.vowPlaceholder')}
              />
            </label>
            <label className="field">
              <span>{t('wizard.rank')}</span>
              <select
                value={raw.backgroundVow?.rank ?? 'troublesome'}
                disabled={!raw.backgroundVow}
                onChange={(e) =>
                  patch({
                    backgroundVow: raw.backgroundVow
                      ? { ...raw.backgroundVow, rank: e.target.value as ChallengeRank }
                      : null,
                  })
                }
              >
                {CHALLENGE_RANKS.map((rank) => (
                  <option key={rank} value={rank}>
                    {rankLabel(rank, t)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wizard-flags">
          <p className="hint">{t('wizard.flagsHint')}</p>
          <div className="field-row">
            <label className="field grow">
              <span>{t('wizard.flagsLabel')}</span>
              <input
                type="text"
                value={flagDraft}
                maxLength={MAX_FLAG_LENGTH}
                onChange={(e) => setFlagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addFlag();
                  }
                }}
                placeholder={t('wizard.flagsPlaceholder')}
                disabled={raw.flags.length >= MAX_FLAGS}
              />
            </label>
            <button type="button" onClick={addFlag} disabled={raw.flags.length >= MAX_FLAGS}>
              {t('wizard.flagsAdd')}
            </button>
          </div>
          {raw.flags.length === 0 ? (
            <p className="hint">{t('wizard.flagsEmpty')}</p>
          ) : (
            <ul className="flag-list">
              {raw.flags.map((flag) => (
                <li key={flag} className="option chosen">
                  <span className="option-body">
                    <strong>{flag}</strong>
                  </span>
                  <button type="button" className="ghost" onClick={() => removeFlag(flag)}>
                    {t('wizard.flagsRemove')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            {t('wizard.flagsCount', { count: raw.flags.length, total: MAX_FLAGS })}
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="wizard-assets">
          <p className="hint">
            {t('wizard.assetsHint', {
              starship: t('wizard.assetsHintStarship'),
              count: INITIAL_ASSET_COUNT,
            })}
          </p>
          <div className="starship-card">
            <strong>{starship?.name ?? t('wizard.assetsHintStarship')}</strong>
            <span className="option-desc">
              <DataswornText text={starship?.abilities[0]?.text ?? ''} />
            </span>
          </div>
          <label className="field">
            <span>{t('wizard.searchAssets')}</span>
            <input
              type="search"
              value={assetFilter}
              onChange={(e) => setAssetFilter(e.target.value)}
              placeholder={t('wizard.searchPlaceholder')}
            />
          </label>
          <p className={assetsOk ? 'hint' : 'msg error'}>
            {t('wizard.picked', { count: raw.assetIds.length, total: INITIAL_ASSET_COUNT })}
          </p>
          {filteredTree.map((category) => (
            <fieldset key={category.id} className="asset-category">
              <legend>
                {category.name} <span className="track-id">({category.assets.length})</span>
              </legend>
              {category.assets.map((asset) => {
                const picked = raw.assetIds.includes(asset.id);
                return (
                  <label key={asset.id} className={picked ? 'option chosen' : 'option'}>
                    <input
                      type="checkbox"
                      checked={picked}
                      onChange={() => toggleAsset(asset.id)}
                    />
                    <span className="option-body">
                      <strong>{asset.name}</strong>
                      <span className="option-desc">
                        <DataswornText text={asset.firstAbility} />
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ))}
        </div>
      )}

      {step === 4 && (
        <div className="wizard-review">
          <h3>{t('wizard.reviewTitle')}</h3>
          <ul>
            <li>
              <strong>{raw.characterName || t('wizard.reviewUnnamed')}</strong> —{' '}
              {STAT_IDS.map((stat) => `${ruleTermLabel(t, 'stat', stat)} ${raw.stats[stat]}`).join(
                ', ',
              )}
            </li>
            {raw.background.trim().length > 0 && (
              <li>
                {t('wizard.reviewBackground', {
                  text:
                    raw.background.trim().length > 120
                      ? `${raw.background.trim().slice(0, 120)}…`
                      : raw.background.trim(),
                })}
              </li>
            )}
            <li>
              {t('wizard.reviewAssets', {
                count: raw.assetIds.length,
                list:
                  raw.assetIds.map((id) => index.getAsset(id)?.name ?? id).join(', ') ||
                  t('wizard.reviewAssetsNone'),
              })}
            </li>
            {raw.backgroundVow && (
              <li>
                {t('wizard.reviewVow', {
                  title: raw.backgroundVow.title,
                  rank: rankLabel(raw.backgroundVow.rank ?? '', t),
                })}
              </li>
            )}
            <li>
              {t('wizard.reviewFlags', {
                list:
                  raw.flags.length > 0
                    ? raw.flags.join(i18n.language.startsWith('zh') ? '、' : ', ')
                    : t('wizard.reviewFlagsNone'),
              })}
            </li>
            <li>{t('wizard.truthsEstablished', { count: truths.length })}</li>
          </ul>
          <p className="hint">{t('wizard.reviewSaveHint')}</p>
        </div>
      )}

      <footer className="wizard-footer">
        <button
          type="button"
          className="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          {t('wizard.back')}
        </button>
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={() => setStep((s) => s + 1)} disabled={!stepOk}>
            {t('wizard.next')}
          </button>
        ) : (
          <button type="button" onClick={finish} disabled={!stepOk}>
            {t('wizard.begin')}
          </button>
        )}
      </footer>
    </section>
  );
}

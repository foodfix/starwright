import { useMemo, useState } from 'react';
import { ADD_ASSET_COST, ENABLE_ABILITY_COST, type CampaignState } from '@starwright/engine';
import { useTranslation } from 'react-i18next';
import { useCampaign } from '../../stores/campaign.js';
import { useChat } from '../../stores/chat.js';
import { ruleTermLabel } from '../../shared/RuleTerm.js';
import { Translatable } from '../../shared/Translatable.js';
import {
  buyReadiness,
  purchasableTree,
  upgradeCandidates,
  upgradeReadiness,
  type AdvanceReadiness,
} from './advance.js';

interface AdvanceStatus {
  kind: 'ok' | 'error';
  text: string;
}

/** Advance panel: spend legacy-earned XP on new assets (+3) and asset
 * abilities (+2). Mechanical purchases go straight through the engine
 * reducer (executeEvent); narrative requirements stay with the player. */
export function AdvancePanel({ state }: { state: CampaignState }) {
  const { t } = useTranslation();
  const index = useCampaign((s) => s.index);
  const execute = useCampaign((s) => s.executeEvent);
  const [filter, setFilter] = useState('');
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<AdvanceStatus | null>(null);

  const upgrades = useMemo(() => (index ? upgradeCandidates(state, index) : []), [state, index]);
  const tree = useMemo(() => (index ? purchasableTree(state, index) : []), [state, index]);
  const filteredTree = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle.length === 0) return tree;
    return tree
      .map((category) => ({
        ...category,
        assets: category.assets.filter(
          (asset) =>
            asset.name.toLowerCase().includes(needle) ||
            asset.category.toLowerCase().includes(needle) ||
            asset.firstAbility.toLowerCase().includes(needle),
        ),
      }))
      .filter((category) => category.assets.length > 0);
  }, [tree, filter]);

  if (!index) return null;

  /** probe with confirmation to detect narrative requirements, then gate on
   * the player's actual checkbox state */
  const gate = (key: string, compute: (c: boolean) => AdvanceReadiness): AdvanceReadiness => {
    const probe = compute(true);
    if (probe.narrativeRequirement === undefined) return probe;
    return compute(confirmed[key] === true);
  };

  const report = (next: AdvanceStatus): void => {
    setStatus(next);
    useChat.getState().pushInfo(next.text);
  };
  const fail = (message: string): void =>
    setStatus({ kind: 'error', text: t('advance.error', { message }) });

  const buy = (assetId: string, name: string): void => {
    const result = execute({ type: 'add_asset', assetId, payWithExperience: true });
    if (!result) return;
    if (!result.ok) return fail(result.error.message);
    if (result.outcome.kind !== 'add_asset') return;
    report({
      kind: 'ok',
      text: t('advance.purchased', {
        name,
        cost: result.outcome.experienceCost,
        xp: result.outcome.experience,
      }),
    });
  };
  const unlock = (instanceId: string, abilityIndex: number, name: string): void => {
    const result = execute({
      type: 'enable_ability',
      assetId: instanceId,
      abilityIndex,
      payWithExperience: true,
      ...(confirmed[`${instanceId}:${abilityIndex}`] ? { requirementConfirmed: true } : {}),
    });
    if (!result) return;
    if (!result.ok) return fail(result.error.message);
    if (result.outcome.kind !== 'enable_ability') return;
    report({
      kind: 'ok',
      text: t('advance.upgraded', {
        name,
        index: abilityIndex + 1,
        cost: result.outcome.experienceCost,
        xp: result.outcome.experience,
      }),
    });
  };

  const requirementRow = (key: string, text: string) => (
    <span className="option-desc advance-requirement">
      {t('advance.requires')} <Translatable text={text} />
      <label className="advance-confirm">
        <input
          type="checkbox"
          checked={confirmed[key] === true}
          onChange={(e) => setConfirmed((prev) => ({ ...prev, [key]: e.target.checked }))}
        />
        {t('advance.requirementConfirmed')}
      </label>
    </span>
  );

  return (
    <div className="advance" aria-label={t('advance.title')}>
      <p className="hint">{t('advance.balance', { xp: state.experience })}</p>
      {status && <p className={status.kind === 'ok' ? 'hint' : 'msg error'}>{status.text}</p>}

      <h3>{t('advance.upgrades', { xp: ENABLE_ABILITY_COST })}</h3>
      {upgrades.length === 0 ? (
        <p className="track-meta">{t('character.none')}</p>
      ) : (
        <ul className="advance-list">
          {upgrades.map(({ instance, name, abilities }) => (
            <li key={instance.id} className="asset-card">
              <span className="track-title">{name}</span>
              {abilities.map(({ abilityIndex, text }) => {
                const key = `${instance.id}:${abilityIndex}`;
                const readiness = gate(key, (c) =>
                  upgradeReadiness(state, index, instance.id, abilityIndex, c),
                );
                return (
                  <div key={abilityIndex} className="option-body advance-item">
                    <span className="option-desc">
                      <Translatable text={text} />
                    </span>
                    {readiness.narrativeRequirement !== undefined &&
                      requirementRow(key, readiness.narrativeRequirement)}
                    {readiness.reason === 'legacy_boxes' && readiness.legacyGap && (
                      <span className="track-meta">
                        {t('advance.blockLegacy', {
                          legacy: ruleTermLabel(
                            t,
                            'legacy',
                            readiness.legacyGap.legacy.replace('_legacy', ''),
                          ),
                          need: readiness.legacyGap.need,
                          have: readiness.legacyGap.have,
                        })}
                      </span>
                    )}
                    {readiness.reason === 'insufficient_xp' && (
                      <span className="track-meta">{t('advance.blockInsufficientXp')}</span>
                    )}
                    <button
                      type="button"
                      className="ghost"
                      disabled={!readiness.ok}
                      onClick={() => unlock(instance.id, abilityIndex, name)}
                    >
                      {t('advance.unlock')} · −{ENABLE_ABILITY_COST} XP
                    </button>
                  </div>
                );
              })}
            </li>
          ))}
        </ul>
      )}

      <h3>{t('advance.buy', { xp: ADD_ASSET_COST })}</h3>
      <label className="field">
        <span>{t('wizard.searchAssets')}</span>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('wizard.searchPlaceholder')}
        />
      </label>
      {filteredTree.length === 0 ? (
        <p className="track-meta">{t('character.none')}</p>
      ) : (
        filteredTree.map((category) => (
          <fieldset key={category.id} className="asset-category">
            <legend>
              {category.name} <span className="track-id">({category.assets.length})</span>
            </legend>
            {category.assets.map((asset) => {
              const key = `buy:${asset.id}`;
              const readiness = gate(key, (c) => buyReadiness(state, index, asset.id, c));
              return (
                <div key={asset.id} className="option-body advance-item">
                  <strong>{asset.name}</strong>
                  <span className="option-desc">
                    <Translatable text={asset.firstAbility} />
                  </span>
                  {readiness.narrativeRequirement !== undefined &&
                    requirementRow(key, readiness.narrativeRequirement)}
                  {readiness.reason === 'legacy_boxes' && readiness.legacyGap && (
                    <span className="track-meta">
                      {t('advance.blockLegacy', {
                        legacy: ruleTermLabel(
                          t,
                          'legacy',
                          readiness.legacyGap.legacy.replace('_legacy', ''),
                        ),
                        need: readiness.legacyGap.need,
                        have: readiness.legacyGap.have,
                      })}
                    </span>
                  )}
                  {readiness.reason === 'insufficient_xp' && (
                    <span className="track-meta">{t('advance.blockInsufficientXp')}</span>
                  )}
                  <button
                    type="button"
                    className="ghost"
                    disabled={!readiness.ok}
                    onClick={() => buy(asset.id, asset.name)}
                  >
                    {t('advance.purchase')} · −{ADD_ASSET_COST} XP
                  </button>
                </div>
              );
            })}
          </fieldset>
        ))
      )}
    </div>
  );
}

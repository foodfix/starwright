import { useState } from 'react';
import {
  assetControlInfos,
  getActiveCharacter,
  momentumMax,
  momentumReset,
  progressScore,
  MOMENTUM_MIN,
} from '@starwright/engine';
import type { CampaignState, CharacterState, ProgressTrack } from '@starwright/engine';
import type { ConditionMeterId, StatId } from '@starwright/data';
import { useTranslation } from 'react-i18next';
import { useCampaign } from '../../stores/campaign.js';
import { useSettings } from '../../stores/settings.js';
import { RuleTerm, ruleTermLabel } from '../../shared/RuleTerm.js';
import { Translatable } from '../../shared/Translatable.js';
import { AdvancePanel } from '../advance/AdvancePanel.js';

const STAT_ORDER: readonly StatId[] = ['edge', 'heart', 'iron', 'shadow', 'wits'];
const METER_ORDER: readonly ConditionMeterId[] = ['health', 'spirit', 'supply'];
const MOMENTUM_MAX = 10;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** rebuild state with the active character replaced by mutate()'s result */
function withActiveCharacter(
  state: CampaignState,
  mutate: (character: CharacterState) => CharacterState,
): CampaignState {
  const idx = state.characters.findIndex((c) => c.id === state.activeCharacterId);
  if (idx === -1) return state;
  const characters = state.characters.slice();
  const character = characters[idx];
  if (!character) return state;
  characters[idx] = mutate(character);
  return { ...state, characters };
}

function MeterBar({
  meter,
  value,
  editing = false,
  onChange,
}: {
  meter: string;
  value: number;
  editing?: boolean;
  onChange?: (value: number) => void;
}) {
  const { t } = useTranslation();
  const label = ruleTermLabel(t, 'meter', meter);
  return (
    <div className="meter">
      <span className="meter-label">
        <RuleTerm kind="meter" id={meter} />
      </span>
      <span className="meter-bar" aria-label={`${label} ${value}/5`}>
        {Array.from({ length: 5 }, (_, i) => (
          <i key={i} className={i < value ? 'tick filled' : 'tick'} />
        ))}
      </span>
      {editing && onChange ? (
        <input
          type="number"
          className="debug-input"
          min={0}
          max={5}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      ) : (
        <span className="meter-value">{value}/5</span>
      )}
    </div>
  );
}

function TrackRow({ id, track }: { id: string; track: ProgressTrack }) {
  const { t } = useTranslation();
  return (
    <li>
      <span className="track-title">{track.title}</span>
      <span className="track-meta">
        {track.rank ? t(`rank.${track.rank}`) : t('character.noRank')} · {track.ticks}/40{' '}
        {t('character.boxes', { score: progressScore(track.ticks) })}
      </span>
      <span className="track-id">{id}</span>
    </li>
  );
}

export function CharacterPanel({ state }: { state: CampaignState }) {
  const { t } = useTranslation();
  const index = useCampaign((s) => s.index);
  const debug = useSettings((s) => s.settings.debug);
  const [editing, setEditing] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const assetName = (assetId: string): string => index?.getAsset(assetId)?.name ?? assetId;
  const character = getActiveCharacter(state);

  const patch = (next: CampaignState): void => {
    useCampaign.getState().debugPatch(next);
  };
  const setName = (name: string): void =>
    patch(withActiveCharacter(state, (c) => ({ ...c, name })));
  const setStat = (stat: StatId, value: number): void =>
    patch(
      withActiveCharacter(state, (c) => ({
        ...c,
        stats: { ...c.stats, [stat]: clampInt(value, 0, 5) },
      })),
    );
  const setMeter = (meter: ConditionMeterId, value: number): void =>
    patch(
      withActiveCharacter(state, (c) => ({
        ...c,
        meters: { ...c.meters, [meter]: clampInt(value, 0, 5) },
      })),
    );
  const setMomentum = (value: number): void =>
    patch({ ...state, momentum: clampInt(value, MOMENTUM_MIN, MOMENTUM_MAX) });
  const setExperience = (value: number): void =>
    patch({ ...state, experience: clampInt(value, 0, Number.MAX_SAFE_INTEGER) });

  return (
    <section className="character" aria-label={t('character.title')}>
      <div className="title-row">
        {editing ? (
          <input
            type="text"
            className="debug-name-input"
            value={character.name}
            aria-label={t('wizard.characterName')}
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          <h2>{character.name}</h2>
        )}
        {debug && (
          <button
            type="button"
            className="ghost debug-toggle"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? t('character.debugDone') : t('character.debugEdit')}
          </button>
        )}
      </div>
      <div className="stats-row">
        {STAT_ORDER.map((stat) => (
          <span key={stat} className="stat">
            <RuleTerm kind="stat" id={stat} />{' '}
            {editing ? (
              <input
                type="number"
                className="debug-input"
                min={0}
                max={5}
                value={character.stats[stat]}
                aria-label={ruleTermLabel(t, 'stat', stat)}
                onChange={(e) => setStat(stat, Number(e.target.value))}
              />
            ) : (
              <strong>{character.stats[stat]}</strong>
            )}
          </span>
        ))}
      </div>
      <div className="meters">
        {METER_ORDER.map((meter) => (
          <MeterBar
            key={meter}
            meter={meter}
            value={character.meters[meter]}
            editing={editing}
            onChange={(value) => setMeter(meter, value)}
          />
        ))}
      </div>
      <div className="momentum">
        <span className="meter-label">{t('character.momentum')}</span>
        {editing ? (
          <input
            type="number"
            className="debug-input"
            min={MOMENTUM_MIN}
            max={MOMENTUM_MAX}
            value={state.momentum}
            aria-label={t('character.momentum')}
            onChange={(e) => setMomentum(Number(e.target.value))}
          />
        ) : (
          <strong>{state.momentum}</strong>
        )}
        <span className="track-meta">
          {t('character.max', { value: momentumMax(state, index ?? undefined) })} ·{' '}
          {t('character.reset', { value: momentumReset(state, index ?? undefined) })}
        </span>
      </div>
      <div className="momentum">
        <span className="meter-label">{t('character.experience')}</span>
        {editing ? (
          <input
            type="number"
            className="debug-input"
            min={0}
            value={state.experience}
            aria-label={t('character.experience')}
            onChange={(e) => setExperience(Number(e.target.value))}
          />
        ) : (
          <strong>{state.experience}</strong>
        )}
        <span className="track-meta">{t('character.xpHint')}</span>
        <button
          type="button"
          className="ghost advance-toggle"
          aria-expanded={advanceOpen}
          onClick={() => setAdvanceOpen((v) => !v)}
        >
          {t('advance.open')}
        </button>
      </div>
      {advanceOpen && <AdvancePanel state={state} />}
      <h3>{t('character.impacts')}</h3>
      {character.impacts.length === 0 ? (
        <p className="track-meta">{t('character.none')}</p>
      ) : (
        <ul className="impact-list">
          {character.impacts.map((impact) => (
            <li key={impact.impactId}>
              <RuleTerm kind="impact" id={impact.impactId} />
              {impact.permanent ? t('character.permanent') : ''}
            </li>
          ))}
        </ul>
      )}
      <h3>{t('character.progressTracks')}</h3>
      {Object.keys(state.tracks).length === 0 ? (
        <p className="track-meta">{t('character.noTracksYet')}</p>
      ) : (
        <ul className="track-list">
          {Object.entries(state.tracks).map(([id, track]) => (
            <TrackRow key={id} id={id} track={track} />
          ))}
        </ul>
      )}
      <h3>{t('character.legacy')}</h3>
      <ul className="track-list">
        {(['quests_legacy', 'bonds_legacy', 'discoveries_legacy'] as const).map((id) => (
          <li key={id}>
            <span className="track-title">
              <RuleTerm kind="legacy" id={id.replace('_legacy', '')} />
            </span>
            <span className="track-meta">
              {state.legacy[id].ticks}/40
              {state.legacy[id].cleared ? t('character.cleared') : ''}
            </span>
          </li>
        ))}
      </ul>
      <h3>{t('character.assets')}</h3>
      {state.assets.length === 0 ? (
        <p className="track-meta">{t('character.none')}</p>
      ) : (
        <ul className="asset-list">
          {state.assets.map((asset) => {
            const def = index?.getAsset(asset.assetId);
            const meterText = Object.entries(asset.meters)
              .map(([key, value]) => {
                const info = def ? assetControlInfos(def).get(key) : undefined;
                return `${key} ${value}${info?.max !== undefined ? `/${info.max}` : ''}`;
              })
              .join(', ');
            const activeControls = Object.entries(asset.controls)
              .filter(([, value]) => value)
              .map(([key]) => key);
            return (
              <li key={asset.id} className="asset-card">
                <details>
                  <summary>
                    <span className="track-title">{assetName(asset.assetId)}</span>
                    <span className="track-meta">
                      {asset.id} ·{' '}
                      {t('character.abilities', { count: asset.enabledAbilities.length })}
                      {meterText ? ` · ${meterText}` : ''}
                      {activeControls.length > 0 ? ` · ${activeControls.join(', ')}` : ''}
                      {asset.attachedTo ? t('character.attachedTo', { id: asset.attachedTo }) : ''}
                    </span>
                  </summary>
                  <div className="details-body">
                    {(def?.abilities ?? []).map((ability, i) => {
                      const enabled = asset.enabledAbilities.includes(i);
                      return (
                        <p key={i} className={enabled ? 'rule-text' : 'track-meta'}>
                          {enabled ? '' : t('character.locked')}
                          <Translatable text={ability.text} />
                        </p>
                      );
                    })}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      <p className="track-meta">{t('character.scene', { index: state.scene.index })}</p>
    </section>
  );
}

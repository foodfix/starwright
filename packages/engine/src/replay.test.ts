import { describe, expect, it } from 'vitest';
import type { StatId } from '@starwright/data';
import { mulberry32 } from './dice/rng.js';
import { createNewCampaign } from './state/create.js';
import { reduce, type EngineContext } from './reducer.js';
import type { EngineEvent } from './events.js';
import type { ActionRollOutcome, ProgressRollOutcome } from './audit.js';
import { realIndex } from './test-support.js';

const STATS: Record<StatId, number> = { edge: 2, heart: 3, iron: 1, shadow: 1, wits: 2 };

const SEED = 777;

function runCampaign(): {
  state: ReturnType<typeof createNewCampaign>;
  outcomes: unknown[];
  failures: string[];
} {
  const ctx: EngineContext = { index: realIndex, rng: mulberry32(SEED) };
  let state = createNewCampaign({ characterName: 'Raven', stats: STATS });
  const outcomes: unknown[] = [];
  const failures: string[] = [];

  const step = (event: EngineEvent): void => {
    const result = reduce(state, event, ctx);
    if (result.ok) {
      state = result.state;
      outcomes.push(result.outcome);
    } else {
      failures.push(result.error.code);
    }
  };

  // 建角：由 createNewCampaign 完成（M4 接入向导后由工具层组合）

  // 立誓：建誓言轨（dangerous）并推进一格
  step({ type: 'add_track', title: 'Recover the Beacon', rank: 'dangerous', kind: 'vow' });
  const vowTrackId = Object.keys(state.tracks)[0]!;
  step({ type: 'mark_progress', trackId: vowTrackId, marks: 2 });

  // 行动：掷骰 + 烧 momentum（若命中仍烧，验证重判路径）
  step({ type: 'adjust_momentum', delta: 4 });
  step({ type: 'action_roll', stat: 'wits' });
  const actionOutcome = outcomes.at(-1) as ActionRollOutcome;
  step({ type: 'burn_momentum', rollId: actionOutcome.rollId });

  // 战斗：开战轨（formidable）推进两格后进度投
  step({ type: 'add_track', title: 'Skirmish at the relay', rank: 'formidable', kind: 'fray' });
  const frayTrackId = Object.keys(state.tracks)[1]!;
  step({ type: 'mark_progress', trackId: frayTrackId, marks: 2 });
  step({ type: 'progress_roll', trackId: frayTrackId });

  // 恢复：受伤 → 治疗被封锁 → 清除 → 恢复
  step({ type: 'adjust_meter', meter: 'health', delta: -5 });
  step({ type: 'mark_impact', impactId: 'wounded' });
  step({ type: 'adjust_meter', meter: 'health', delta: 1 }); // 预期失败：meter_recovery_blocked
  step({ type: 'clear_impact', impactId: 'wounded' });
  step({ type: 'adjust_meter', meter: 'health', delta: 2 });

  // legacy 与场景收尾
  step({ type: 'adjust_legacy', legacy: 'quests_legacy', ticks: 2 });
  step({ type: 'set_flag', key: 'beacon_recovered', value: true });
  step({ type: 'set_aboard_vehicle', assetIds: ['starforged/assets/command_vehicle/starship'] });
  step({ type: 'add_journal_entry', text: 'The beacon is ours. For now.' });
  step({ type: 'end_scene' });

  return { state, outcomes, failures };
}

describe('pure-function campaign replay (no UI)', () => {
  it('runs the full flow and asserts the final state', () => {
    const { state, outcomes, failures } = runCampaign();

    expect(failures).toEqual(['meter_recovery_blocked']);
    expect(state.version).toBe(4);
    expect(state.contentFlags).toEqual([]);
    expect(state.experience).toBe(0);
    expect(Object.keys(state.tracks)).toHaveLength(2);

    const vow = Object.values(state.tracks)[0]!;
    expect(vow).toEqual({ title: 'Recover the Beacon', rank: 'dangerous', kind: 'vow', ticks: 16 });
    const fray = Object.values(state.tracks)[1]!;
    expect(fray.ticks).toBe(8);

    const progress = outcomes.find(
      (o): o is ProgressRollOutcome => (o as ProgressRollOutcome).kind === 'progress_roll',
    );
    expect(progress?.score).toBe(2);

    expect(state.characters[0]?.meters.health).toBe(2);
    expect(state.characters[0]?.impacts).toEqual([]);
    expect(state.legacy.quests_legacy.ticks).toBe(2);
    expect(state.scene.index).toBe(2);
    expect(state.scene.flags['beacon_recovered']).toBe(true);
    expect(state.scene.aboardVehicleAssetIds).toEqual([
      'starforged/assets/command_vehicle/starship',
    ]);
    expect(state.journal.at(-1)?.kind).toBe('settlement');

    // 掷骰审计：全部骰值在合法范围
    for (const entry of state.journal) {
      const outcome = entry.outcome;
      if (outcome?.kind === 'action_roll') {
        expect(outcome.dice.actionDie).toBeGreaterThanOrEqual(1);
        expect(outcome.dice.actionDie).toBeLessThanOrEqual(10);
        for (const c of outcome.dice.challenge) {
          expect(c).toBeGreaterThanOrEqual(1);
          expect(c).toBeLessThanOrEqual(10);
        }
      }
    }

    const burn = outcomes.find((o) => (o as { kind: string }).kind === 'burn_momentum') as
      { result: { burned: boolean }; momentumAfter: number; reset: number } | undefined;
    expect(burn?.result.burned).toBe(true);
    expect(state.momentum).toBe(burn?.momentumAfter);
  });

  it('replays deterministically from the same seed and event sequence', () => {
    const first = runCampaign();
    const second = runCampaign();
    expect(second.state).toEqual(first.state);
    expect(second.outcomes).toEqual(first.outcomes);
    expect(second.failures).toEqual(first.failures);
  });

  it('keeps the journal within its rolling limit under load', () => {
    const ctx: EngineContext = { index: realIndex, rng: mulberry32(SEED) };
    let state = createNewCampaign({ characterName: 'R', stats: STATS });
    for (let i = 0; i < 600; i++) {
      const result = reduce(state, { type: 'add_journal_entry', text: `entry ${i}` }, ctx);
      if (!result.ok) throw new Error(result.error.message);
      state = result.state;
    }
    expect(state.journal.length).toBeLessThanOrEqual(500);
    expect(state.journal[0]?.note).toBe('entry 100');
    expect(state.journal.at(-1)?.note).toBe('entry 599');
  });
});

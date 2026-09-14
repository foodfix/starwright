import { describe, expect, it } from 'vitest';
import { executeToolCall, toolResultContent } from './executor.js';
import { testExecutor } from './test-support.js';

describe('executeToolCall: make_move', () => {
  it('resolves an action-roll move and returns authoritative outcome text', () => {
    const { ctx, state } = testExecutor();
    const execution = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/adventure/face_danger', stat: 'wits' }),
      ctx,
    );
    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    const payload = execution.payload as {
      move: { id: string };
      outcomeKind: string;
      text?: string;
      engineOutcome: {
        outcome: string;
        dice: { actionDie: number; challenge: number[] };
        rollId: string;
      };
    };
    expect(payload.move.id).toBe('starforged/moves/adventure/face_danger');
    expect(payload.outcomeKind).toBe(payload.engineOutcome.outcome);
    expect(payload.text).toContain('__');
    expect(payload.engineOutcome.dice.challenge).toHaveLength(2);
    // settlement recorded in journal
    const settlements = state().journal.filter((e) => e.kind === 'settlement');
    expect(settlements).toHaveLength(1);
    // strong hit text of face_danger grants +1 momentum — engine does not auto-apply
    expect(state().momentum).toBe(2);
  });

  it('expands {{table:...}} in outcome text by rolling nested tables', () => {
    // the {{table:...}} reference lives in the miss outcome; scan fixed seeds
    // until one produces it, then assert the marker was substituted
    let hit: { text: string; nested: unknown[] } | null = null;
    for (let seed = 1; seed <= 200 && !hit; seed++) {
      const { ctx } = testExecutor(undefined, seed);
      const execution = executeToolCall(
        'make_move',
        JSON.stringify({ move_id: 'starforged/moves/suffer/endure_harm', stat: 'iron' }),
        ctx,
      );
      if (!execution.ok) continue;
      const payload = execution.payload as {
        outcomeKind: string;
        text: string;
        nestedOracleRolls?: Array<{ roll: number; text: string }>;
      };
      if (payload.nestedOracleRolls && payload.nestedOracleRolls.length > 0) {
        hit = { text: payload.text, nested: payload.nestedOracleRolls };
      }
    }
    expect(hit).not.toBeNull();
    expect(hit?.text).not.toContain('{{table:');
    expect(hit?.nested.length).toBeGreaterThan(0);
  });

  it('resolves a progress-roll move against an existing track', () => {
    const { ctx } = testExecutor();
    executeToolCall(
      'swear_vow',
      JSON.stringify({ title: 'Find my sister', rank: 'dangerous' }),
      ctx,
    );
    const vow = Object.entries(ctx.getState().tracks).find(([, t]) => t.kind === 'vow');
    expect(vow).toBeDefined();
    const trackId = vow?.[0] as string;
    executeToolCall('mark_progress', JSON.stringify({ track_id: trackId }), ctx);
    const execution = executeToolCall(
      'make_move',
      JSON.stringify({
        move_id: 'starforged/moves/quest/fulfill_your_vow',
        track_id: trackId,
      }),
      ctx,
    );
    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    const payload = execution.payload as { engineOutcome: { score: number; kind: string } };
    expect(payload.engineOutcome.kind).toBe('progress_roll');
    expect(payload.engineOutcome.score).toBe(2); // 8 ticks = 2 boxes
  });

  it('progress-roll move without track_id fails with a hint', () => {
    const { ctx } = testExecutor();
    const execution = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/quest/fulfill_your_vow' }),
      ctx,
    );
    expect(execution.ok).toBe(false);
    if (execution.ok) return;
    expect(execution.error.code).toBe('invalid_input');
    expect(execution.error.hint).toBeTruthy();
  });

  it('no-roll moves return text without dice', () => {
    const { ctx, state } = testExecutor();
    const seqBefore = state().seq;
    const execution = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/fate/pay_the_price' }),
      ctx,
    );
    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    const payload = execution.payload as { note: string; text: string };
    expect(payload.note).toContain('no roll');
    expect(payload.text.length).toBeGreaterThan(0);
    expect(state().seq).toBe(seqBefore); // no engine event, no state change
  });

  it('resolves special_track Overcome Destruction against the bonds legacy track (M4)', () => {
    const { ctx } = testExecutor(undefined, 11);
    const execution = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/threshold/overcome_destruction' }),
      ctx,
    );
    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    const payload = execution.payload as {
      outcomeKind: string;
      engineOutcome: { kind: string; trackId: string; score: number };
      text: string;
    };
    expect(payload.engineOutcome.kind).toBe('progress_roll');
    expect(payload.engineOutcome.trackId).toBe('bonds_legacy');
    expect(payload.engineOutcome.score).toBe(0);
    expect(['strong_hit', 'weak_hit', 'miss']).toContain(payload.outcomeKind);
    expect(payload.text).toContain('command vehicle');
  });

  it('resolves special_track Continue a Legacy with one roll per legacy track (M4)', () => {
    const { ctx } = testExecutor(undefined, 12);
    const execution = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/legacy/continue_a_legacy' }),
      ctx,
    );
    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    const payload = execution.payload as {
      rolls?: Array<{ legacy: string; outcomeKind: string }>;
      text: string;
    };
    expect(payload.rolls?.map((r) => r.legacy)).toEqual([
      'quests_legacy',
      'bonds_legacy',
      'discoveries_legacy',
    ]);
    for (const roll of payload.rolls ?? []) {
      expect(['strong_hit', 'weak_hit', 'miss']).toContain(roll.outcomeKind);
    }
    expect(payload.text).toContain('legacy tracks');
  });

  it('rejects a selection outside the trigger options with the valid list (M4)', () => {
    const { ctx } = testExecutor();
    const execution = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/adventure/gather_information', stat: 'iron' }),
      ctx,
    );
    expect(execution.ok).toBe(false);
    if (execution.ok) return;
    expect(execution.error.code).toBe('invalid_roll_selection');
    expect(execution.error.hint).toContain('stat:wits');
  });

  it('demands a roll selection when none is provided (M4)', () => {
    const { ctx } = testExecutor();
    const execution = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/adventure/face_danger' }),
      ctx,
    );
    expect(execution.ok).toBe(false);
    if (execution.ok) return;
    expect(execution.error.code).toBe('roll_selection_required');
    expect(execution.error.hint).toContain('stat:edge');
  });

  it('auto-picks highest(iron|health) for Endure Harm when unspecified (M4)', () => {
    const { ctx } = testExecutor(undefined, 21);
    // health 5 > iron 2 → health; then drop health to 1 → iron wins
    const high = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/suffer/endure_harm' }),
      ctx,
    );
    expect(high.ok).toBe(true);
    if (!high.ok) return;
    expect((high.payload as { selection?: string }).selection).toBe('highest(health)=5');
    expect((high.payload as { engineOutcome: { meter?: string } }).engineOutcome.meter).toBe(
      'health',
    );
    executeToolCall('adjust_meter', JSON.stringify({ meter: 'health', delta: -4 }), ctx);
    const low = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/suffer/endure_harm' }),
      ctx,
    );
    expect(low.ok).toBe(true);
    if (!low.ok) return;
    expect((low.payload as { selection?: string }).selection).toBe('highest(iron)=2');
    expect((low.payload as { engineOutcome: { stat?: string } }).engineOutcome.stat).toBe('iron');
  });

  it('maps custom trigger options to adds for Develop Your Relationship (M4)', () => {
    const { ctx } = testExecutor();
    const missing = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/connection/develop_your_relationship' }),
      ctx,
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe('roll_selection_required');
    expect(missing.error.hint).toContain('add:3 (formidable)');
    const bad = executeToolCall(
      'make_move',
      JSON.stringify({
        move_id: 'starforged/moves/connection/develop_your_relationship',
        add: 7,
      }),
      ctx,
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.code).toBe('invalid_roll_selection');
    const good = executeToolCall(
      'make_move',
      JSON.stringify({
        move_id: 'starforged/moves/connection/develop_your_relationship',
        add: 3,
      }),
      ctx,
    );
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    const outcome = (good.payload as { engineOutcome: { baseValue: number; add: number } })
      .engineOutcome;
    expect(outcome.baseValue).toBe(0);
    expect(outcome.add).toBe(3);
  });

  it('expands no-roll move text tables and auto-rolls the single unreferenced oracle (M4)', () => {
    const { ctx } = testExecutor(undefined, 5);
    const execution = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/fate/pay_the_price' }),
      ctx,
    );
    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    const payload = execution.payload as {
      text: string;
      nestedOracleRolls?: Array<{ tableId: string }>;
      oracleRolls?: Array<{ tableId: string; roll: number; text: string }>;
    };
    expect(payload.text).not.toContain('{{table:');
    expect(payload.text).toContain('Roll on the table below');
    expect(payload.nestedOracleRolls?.map((r) => r.tableId)).toEqual([
      'starforged/oracles/moves/pay_the_price',
    ]);
    expect(payload.oracleRolls?.map((r) => r.tableId)).toEqual([
      'starforged/oracles/misc/story_complication',
    ]);
    expect(payload.oracleRolls?.[0]?.roll).toBeGreaterThanOrEqual(1);
  });

  it('Ask the Oracle lists odds candidates and rolls the chosen table via oracle_id (M4)', () => {
    const { ctx } = testExecutor(undefined, 6);
    const base = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/fate/ask_the_oracle' }),
      ctx,
    );
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const candidates = (base.payload as { oracleCandidates?: string[] }).oracleCandidates ?? [];
    expect(candidates).toHaveLength(5);
    expect(candidates).toContain('starforged/oracles/moves/ask_the_oracle/fifty_fifty');
    const chosen = executeToolCall(
      'make_move',
      JSON.stringify({
        move_id: 'starforged/moves/fate/ask_the_oracle',
        oracle_id: 'starforged/oracles/moves/ask_the_oracle/likely',
      }),
      ctx,
    );
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    const payload = chosen.payload as { oracleRolls?: Array<{ tableId: string }> };
    expect(payload.oracleRolls?.[0]?.tableId).toBe(
      'starforged/oracles/moves/ask_the_oracle/likely',
    );
    const bad = executeToolCall(
      'make_move',
      JSON.stringify({
        move_id: 'starforged/moves/fate/ask_the_oracle',
        oracle_id: 'starforged/oracles/core/action',
      }),
      ctx,
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.code).toBe('invalid_input');
    expect(bad.error.hint).toContain('ask_the_oracle');
  });

  it('asset_control moves roll with owned assets and refuse without one (M5)', () => {
    const { ctx } = testExecutor(undefined, 31);
    for (const moveId of [
      'starforged/moves/suffer/companion_takes_a_hit',
      'starforged/moves/suffer/withstand_damage',
    ]) {
      const execution = executeToolCall('make_move', JSON.stringify({ move_id: moveId }), ctx);
      expect(execution.ok, moveId).toBe(false);
      if (execution.ok) continue;
      expect(execution.error.code).toBe('asset_control_no_asset');
    }
    const seeded = executeToolCall(
      'add_asset',
      JSON.stringify({ asset_id: 'starforged/assets/companion/banshee' }),
      ctx,
    );
    expect(seeded.ok).toBe(true);
    const resolved = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/suffer/companion_takes_a_hit' }),
      ctx,
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const payload = resolved.payload as {
      selection?: string;
      engineOutcome?: { assetMeter?: { assetId: string; control: string } };
    };
    expect(payload.engineOutcome?.assetMeter).toEqual({ assetId: 'asset-0', control: 'health' });
    expect(payload.selection).toBe('asset:asset-0(health)');
  });

  it('resolves every move in the catalog (M5: 12 categories + asset moves)', () => {
    const { ctx } = testExecutor(undefined, 31);
    // seed assets so asset_control / attached_asset_control triggers resolve:
    // starship (integrity), banshee (health), and two modules attached to the ship
    const seeds = [
      { asset_id: 'starforged/assets/command_vehicle/starship' },
      { asset_id: 'starforged/assets/companion/banshee' },
      {
        asset_id: 'starforged/assets/module/grappler',
        attach_to: 'asset-0',
      },
      {
        asset_id: 'starforged/assets/module/internal_refit',
        attach_to: 'asset-0',
      },
    ];
    for (const seed of seeds) {
      const seeded = executeToolCall('add_asset', JSON.stringify(seed), ctx);
      expect(seeded.ok, JSON.stringify(seeded)).toBe(true);
    }
    const counts = { action_roll: 0, progress_roll: 0, no_roll: 0, special_track: 0 };
    for (const category of ctx.index.listMoves()) {
      for (const entry of category.moves) {
        const move = ctx.index.getMove(entry.id);
        expect(move, entry.id).toBeDefined();
        const args: Record<string, string | number> = { move_id: entry.id };
        if (entry.rollType === 'action_roll') {
          const options = (move?.trigger?.conditions ?? []).flatMap(
            (condition) => condition.roll_options ?? [],
          );
          const stat = options.find((option) => option.using === 'stat')?.stat;
          const meter = options.find(
            (option) => option.using === 'condition_meter',
          )?.condition_meter;
          const custom = options.find((option) => option.using === 'custom');
          if (stat) args['stat'] = stat;
          else if (meter) args['meter'] = meter;
          else if (custom?.value !== undefined) args['add'] = custom.value;
        }
        if (entry.rollType === 'progress_roll') {
          const created = executeToolCall(
            'add_track',
            JSON.stringify({ title: `Track for ${entry.id}`, rank: 'dangerous' }),
            ctx,
          );
          expect(created.ok, entry.id).toBe(true);
          const keys = Object.keys(ctx.getState().tracks);
          args['track_id'] = keys[keys.length - 1] ?? '';
        }
        const execution = executeToolCall('make_move', JSON.stringify(args), ctx);
        counts[entry.rollType] += 1;
        expect(
          execution.ok,
          `${entry.id}: ${execution.ok ? '' : JSON.stringify(execution.error)}`,
        ).toBe(true);
        if (!execution.ok) continue;
        if (entry.rollType === 'action_roll' || entry.rollType === 'progress_roll') {
          const payload = execution.payload as { engineOutcome?: { kind: string } };
          expect(payload.engineOutcome?.kind, entry.id).toBe(entry.rollType);
        }
      }
    }
    expect(counts).toEqual({ action_roll: 42, progress_roll: 5, no_roll: 18, special_track: 3 });
  });

  it('unknown move id yields unknown_move with hint', () => {
    const { ctx } = testExecutor();
    const execution = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/nope' }),
      ctx,
    );
    expect(execution.ok).toBe(false);
    if (execution.ok) return;
    expect(execution.error.code).toBe('unknown_move');
  });
});

describe('executeToolCall: oracles and details', () => {
  it('rolls a real oracle table with dice and match flag', () => {
    const { ctx } = testExecutor(undefined, 7);
    const execution = executeToolCall(
      'roll_oracle',
      JSON.stringify({ table_id: 'starforged/oracles/core/action' }),
      ctx,
    );
    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    const payload = execution.payload as {
      roll: number;
      match: boolean;
      text: string;
      tableId: string;
    };
    expect(payload.roll).toBeGreaterThanOrEqual(1);
    expect(payload.roll).toBeLessThanOrEqual(100);
    // match = tens digit equals units digit (00 = 100 also matches)
    expect(payload.match).toBe(payload.roll === 100 || payload.roll % 11 === 0);
    expect(payload.text.length).toBeGreaterThan(0);
  });

  it('returns row list for get_oracle_detail', () => {
    const { ctx } = testExecutor();
    const execution = executeToolCall(
      'get_oracle_detail',
      JSON.stringify({ table_id: 'starforged/oracles/core/action' }),
      ctx,
    );
    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    const payload = execution.payload as {
      rows: Array<{ min: number; max: number; text: string }>;
    };
    expect(payload.rows.length).toBeGreaterThan(10);
    expect(payload.rows[0]?.min).toBe(1);
  });

  it('returns trigger and outcomes for get_move_detail', () => {
    const { ctx } = testExecutor();
    const execution = executeToolCall(
      'get_move_detail',
      JSON.stringify({ move_id: 'starforged/moves/adventure/face_danger' }),
      ctx,
    );
    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    const payload = execution.payload as {
      name: string;
      trigger: { conditions: unknown[] };
      outcomes: Record<string, { text: string }>;
    };
    expect(payload.name).toBe('Face Danger');
    expect(payload.trigger.conditions.length).toBeGreaterThan(0);
    expect(Object.keys(payload.outcomes).sort()).toEqual(['miss', 'strong_hit', 'weak_hit']);
  });

  it('unknown table yields unknown_table', () => {
    const { ctx } = testExecutor();
    const execution = executeToolCall(
      'roll_oracle',
      JSON.stringify({ table_id: 'starforged/oracles/nope' }),
      ctx,
    );
    expect(execution.ok).toBe(false);
    if (execution.ok) return;
    expect(execution.error.code).toBe('unknown_table');
  });
});

describe('executeToolCall: state tools', () => {
  it('adjust_meter clamps and rejects blocked recovery', () => {
    const { ctx } = testExecutor();
    executeToolCall('adjust_meter', JSON.stringify({ meter: 'health', delta: -2 }), ctx);
    expect(ctx.getState().characters[0]?.meters.health).toBe(3);
    executeToolCall('mark_impact', JSON.stringify({ impact_id: 'wounded' }), ctx);
    const blocked = executeToolCall(
      'adjust_meter',
      JSON.stringify({ meter: 'health', delta: 1 }),
      ctx,
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.code).toBe('meter_recovery_blocked');
    executeToolCall('clear_impact', JSON.stringify({ impact_id: 'wounded' }), ctx);
    const recovered = executeToolCall(
      'adjust_meter',
      JSON.stringify({ meter: 'health', delta: 1 }),
      ctx,
    );
    expect(recovered.ok).toBe(true);
  });

  it('burn_momentum re-judges a previous roll and resets momentum', () => {
    const { ctx } = testExecutor(undefined, 1234);
    const roll = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/adventure/face_danger', stat: 'iron' }),
      ctx,
    );
    expect(roll.ok).toBe(true);
    const rollId = roll.ok
      ? (roll.payload as { engineOutcome: { rollId: string } }).engineOutcome.rollId
      : '';
    executeToolCall('adjust_momentum', JSON.stringify({ delta: 4 }), ctx);
    expect(ctx.getState().momentum).toBe(6);
    const burn = executeToolCall('burn_momentum', JSON.stringify({ roll_id: rollId }), ctx);
    expect(burn.ok).toBe(true);
    if (!burn.ok) return;
    const payload = burn.payload as { momentumBefore: number; momentumAfter: number };
    expect(payload.momentumBefore).toBe(6);
    expect(payload.momentumAfter).toBe(2);
    const again = executeToolCall('burn_momentum', JSON.stringify({ roll_id: rollId }), ctx);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('already_burned');
  });

  it('mark_progress and set_flag/add_journal_entry/end_scene work end to end', () => {
    const { ctx, state } = testExecutor();
    executeToolCall(
      'add_track',
      JSON.stringify({ title: 'Clear the derelict', rank: 'formidable', kind: 'fray' }),
      ctx,
    );
    const trackId = Object.keys(ctx.getState().tracks)[0] as string;
    expect(
      executeToolCall('mark_progress', JSON.stringify({ track_id: trackId, marks: 2 }), ctx).ok,
    ).toBe(true);
    expect(ctx.getState().tracks[trackId]?.ticks).toBe(8);
    expect(
      executeToolCall('set_flag', JSON.stringify({ key: 'ally', value: 'Cassia' }), ctx).ok,
    ).toBe(true);
    const journal = executeToolCall(
      'add_journal_entry',
      JSON.stringify({ text: 'Cassia joined the crew.' }),
      ctx,
    );
    expect(journal.ok).toBe(true);
    if (journal.ok) {
      // payload carries the note text for the UI settlement card
      expect(journal.payload).toMatchObject({
        kind: 'add_journal_entry',
        text: 'Cassia joined the crew.',
      });
    }
    expect(executeToolCall('end_scene', '{}', ctx).ok).toBe(true);
    expect(state().scene.index).toBe(2);
  });

  it('malformed JSON arguments produce invalid_json error', () => {
    const { ctx } = testExecutor();
    const execution = executeToolCall('roll_oracle', '{not json', ctx);
    expect(execution.ok).toBe(false);
    if (execution.ok) return;
    expect(execution.error.code).toBe('invalid_json');
    expect(toolResultContent(execution)).toContain('"error"');
  });

  it('unregistered tools are refused', () => {
    const { ctx } = testExecutor();
    const execution = executeToolCall('teleport_to_vault', '{}', ctx);
    expect(execution.ok).toBe(false);
    if (execution.ok) return;
    expect(execution.error.code).toBe('unknown_tool');
  });

  it('successful tool content is the payload itself; failures wrap the error', () => {
    const { ctx } = testExecutor();
    const ok = executeToolCall('end_scene', '{}', ctx);
    expect(JSON.parse(toolResultContent(ok))).toMatchObject({ kind: 'end_scene' });
    const bad = executeToolCall('make_move', '{"move_id":"x"}', ctx);
    expect(JSON.parse(toolResultContent(bad))).toEqual({
      error: { code: 'unknown_move', message: expect.any(String), hint: expect.any(String) },
    });
  });
});

describe('executeToolCall: M5 asset and legacy tools', () => {
  const STARSHIP = 'starforged/assets/command_vehicle/starship';
  const BANSHEE = 'starforged/assets/companion/banshee';
  const SHIELDS = 'starforged/assets/module/shields';
  const HOMESTEADER = 'starforged/assets/deed/homesteader';
  const BONDED = 'starforged/assets/deed/bonded';

  interface Added {
    ctx: ReturnType<typeof testExecutor>['ctx'];
    instanceId: string;
  }

  function addAsset(
    ctx: ReturnType<typeof testExecutor>['ctx'],
    args: Record<string, unknown>,
  ): Added['instanceId'] {
    const execution = executeToolCall('add_asset', JSON.stringify(args), ctx);
    expect(execution.ok, JSON.stringify(args)).toBe(true);
    if (!execution.ok) throw new Error('add_asset failed');
    const payload = execution.payload as { asset: { instanceId: string } };
    return payload.asset.instanceId;
  }

  function legacy(
    ctx: ReturnType<typeof testExecutor>['ctx'],
    args: Record<string, unknown>,
  ): void {
    const execution = executeToolCall('adjust_legacy', JSON.stringify(args), ctx);
    expect(execution.ok, JSON.stringify(args)).toBe(true);
  }

  it('add_asset charges 3 XP via pay_with_experience', () => {
    const { ctx, state } = testExecutor(undefined, 5);
    legacy(ctx, { legacy: 'quests_legacy', ticks: 8 });
    expect(state().experience).toBe(4);
    const id = addAsset(ctx, { asset_id: BANSHEE, pay_with_experience: true });
    expect(id).toBeTruthy();
    expect(state().experience).toBe(1);
    expect(state().assets.find((a) => a.id === id)?.meters).toEqual({ health: 4 });
  });

  it('enable_ability enforces XP, requirement assertions and confirmation', () => {
    const { ctx, state } = testExecutor(undefined, 5);
    const homesteader = addAsset(ctx, { asset_id: HOMESTEADER });
    const banned = addAsset(ctx, { asset_id: BANSHEE });
    expect(banned).toBeTruthy();
    const noXp = executeToolCall(
      'enable_ability',
      JSON.stringify({ asset_id: homesteader, ability_index: 1, pay_with_experience: true }),
      ctx,
    );
    expect(noXp.ok).toBe(false);
    if (!noXp.ok) expect(noXp.error.code).toBe('requirement_unmet');
    legacy(ctx, { legacy: 'bonds_legacy', ticks: 16 });
    const unlocked = executeToolCall(
      'enable_ability',
      JSON.stringify({ asset_id: homesteader, ability_index: 1, pay_with_experience: true }),
      ctx,
    );
    expect(JSON.parse(toolResultContent(unlocked))).toMatchObject({
      abilityIndex: 1,
      experienceCost: 2,
      experience: 6,
    });
    const bonded = addAsset(ctx, { asset_id: BONDED });
    const needsConfirm = executeToolCall(
      'enable_ability',
      JSON.stringify({ asset_id: bonded, ability_index: 1 }),
      ctx,
    );
    expect(needsConfirm.ok).toBe(false);
    if (!needsConfirm.ok) {
      expect(needsConfirm.error.code).toBe('requirement_confirmation_required');
    }
    const confirmed = executeToolCall(
      'enable_ability',
      JSON.stringify({
        asset_id: bonded,
        ability_index: 1,
        requirement_confirmed: true,
        pay_with_experience: true,
      }),
      ctx,
    );
    expect(confirmed.ok).toBe(true);
    expect(state().assets.find((a) => a.id === bonded)?.enabledAbilities).toEqual([0, 1]);
  });

  it('adjust_asset_meter clamps and refuses integrity recovery while battered', () => {
    const { ctx } = testExecutor(undefined, 5);
    const banshee = addAsset(ctx, { asset_id: BANSHEE });
    const hurt = executeToolCall(
      'adjust_asset_meter',
      JSON.stringify({ asset_id: banshee, control: 'health', delta: -4 }),
      ctx,
    );
    expect(JSON.parse(toolResultContent(hurt))).toMatchObject({ before: 4, after: 0 });
    const healed = executeToolCall(
      'adjust_asset_meter',
      JSON.stringify({ asset_id: banshee, control: 'health', delta: 2 }),
      ctx,
    );
    expect(JSON.parse(toolResultContent(healed))).toMatchObject({ before: 0, after: 2 });
    const ship = addAsset(ctx, { asset_id: STARSHIP });
    executeToolCall(
      'adjust_asset_meter',
      JSON.stringify({ asset_id: ship, control: 'integrity', delta: -3 }),
      ctx,
    );
    executeToolCall('mark_impact', JSON.stringify({ impact_id: 'battered', asset_id: ship }), ctx);
    const blocked = executeToolCall(
      'adjust_asset_meter',
      JSON.stringify({ asset_id: ship, control: 'integrity', delta: 1 }),
      ctx,
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('integrity_recovery_blocked');
  });

  it('set_asset_control refuses impact controls and tracks out_of_action', () => {
    const { ctx } = testExecutor(undefined, 5);
    const ship = addAsset(ctx, { asset_id: STARSHIP });
    const refused = executeToolCall(
      'set_asset_control',
      JSON.stringify({ asset_id: ship, control: 'battered', value: true }),
      ctx,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('control_is_impact');
    const banshee = addAsset(ctx, { asset_id: BANSHEE });
    const off = executeToolCall(
      'set_asset_control',
      JSON.stringify({ asset_id: banshee, control: 'out_of_action', value: true }),
      ctx,
    );
    expect(JSON.parse(toolResultContent(off))).toMatchObject({
      control: 'out_of_action',
      value: true,
    });
  });

  it('discard_asset removes the instance and its impacts', () => {
    const { ctx, state } = testExecutor(undefined, 5);
    const ship = addAsset(ctx, { asset_id: STARSHIP });
    executeToolCall('mark_impact', JSON.stringify({ impact_id: 'battered', asset_id: ship }), ctx);
    const discarded = executeToolCall('discard_asset', JSON.stringify({ asset_id: ship }), ctx);
    const payload = JSON.parse(toolResultContent(discarded)) as { clearedImpacts: string[] };
    expect(payload.clearedImpacts).toEqual(['battered']);
    expect(state().assets).toHaveLength(0);
  });

  it('adjust_legacy accrues XP per filled box; mark_bond_decrease reduces without XP', () => {
    const { ctx, state } = testExecutor(undefined, 5);
    legacy(ctx, { legacy: 'bonds_legacy', ticks: 8 });
    expect(state().experience).toBe(4);
    const loss = executeToolCall('mark_bond_decrease', JSON.stringify({ ticks: 4 }), ctx);
    expect(JSON.parse(toolResultContent(loss))).toMatchObject({
      ticksAdded: -4,
      experienceGained: 0,
    });
    expect(state().experience).toBe(4);
    legacy(ctx, { legacy: 'bonds_legacy', ticks: 40 });
    expect(state().legacy.bonds_legacy).toEqual({ ticks: 0, cleared: true });
    expect(state().experience).toBe(22);
  });

  it('update_track rewrites ticks and rank for recommit flows', () => {
    const { ctx } = testExecutor(undefined, 5);
    executeToolCall(
      'swear_vow',
      JSON.stringify({ title: 'Recover the Beacon', rank: 'dangerous' }),
      ctx,
    );
    executeToolCall('mark_progress', JSON.stringify({ track_id: 'track-0', marks: 2 }), ctx);
    const updated = executeToolCall(
      'update_track',
      JSON.stringify({ track_id: 'track-0', ticks: 4, rank: 'formidable' }),
      ctx,
    );
    expect(JSON.parse(toolResultContent(updated))).toMatchObject({
      rankBefore: 'dangerous',
      rank: 'formidable',
      ticksBefore: 16,
      ticks: 4,
    });
  });

  it('fulfill_vow awards the quests legacy reward on a hit and removes the track', () => {
    const { ctx, state } = testExecutor(undefined, 17);
    executeToolCall(
      'swear_vow',
      JSON.stringify({ title: 'Recover the Beacon', rank: 'dangerous' }),
      ctx,
    );
    executeToolCall('mark_progress', JSON.stringify({ track_id: 'track-0', marks: 2 }), ctx);
    const fulfilled = executeToolCall('fulfill_vow', JSON.stringify({ track_id: 'track-0' }), ctx);
    const payload = JSON.parse(toolResultContent(fulfilled)) as {
      outcomeKind: string;
      legacyReward?: { legacy: string; ticks: number };
      trackRemoved?: string;
    };
    expect(['strong_hit', 'weak_hit', 'miss']).toContain(payload.outcomeKind);
    if (payload.outcomeKind === 'miss') {
      expect(payload.legacyReward).toBeUndefined();
      expect(state().tracks['track-0']).toBeDefined();
      return;
    }
    expect(payload.legacyReward).toEqual({ legacy: 'quests_legacy', ticks: 2 });
    expect(payload.trackRemoved).toBe('track-0');
    expect(state().tracks['track-0']).toBeUndefined();
    expect(state().experience).toBe(0);
  });

  it('forsake_vow clears the vow track', () => {
    const { ctx, state } = testExecutor(undefined, 5);
    executeToolCall(
      'swear_vow',
      JSON.stringify({ title: 'A promise best forgotten', rank: 'troublesome' }),
      ctx,
    );
    const forsaken = executeToolCall('forsake_vow', JSON.stringify({ track_id: 'track-0' }), ctx);
    const payload = JSON.parse(toolResultContent(forsaken)) as { trackRemoved: string };
    expect(payload.trackRemoved).toBe('track-0');
    expect(state().tracks['track-0']).toBeUndefined();
  });

  it('forge_bond asks for confirmation on weak hits and awards bonds on success', () => {
    const { ctx, state } = testExecutor(undefined, 23);
    executeToolCall(
      'add_track',
      JSON.stringify({
        title: 'Olda, the freighter captain',
        rank: 'dangerous',
        kind: 'connection',
      }),
      ctx,
    );
    executeToolCall('mark_progress', JSON.stringify({ track_id: 'track-0', marks: 2 }), ctx);
    const first = JSON.parse(
      toolResultContent(
        executeToolCall('forge_bond', JSON.stringify({ track_id: 'track-0' }), ctx),
      ),
    ) as { outcomeKind: string; legacyReward?: { legacy: string; ticks: number } };
    if (first.outcomeKind === 'weak_hit') {
      expect(first.legacyReward).toBeUndefined();
      expect(state().tracks['track-0']).toBeDefined();
      const confirmed = JSON.parse(
        toolResultContent(
          executeToolCall(
            'forge_bond',
            JSON.stringify({ track_id: 'track-0', confirmed: true }),
            ctx,
          ),
        ),
      ) as { legacyReward?: { legacy: string; ticks: number } };
      expect(confirmed.legacyReward).toEqual({ legacy: 'bonds_legacy', ticks: 2 });
      expect(state().tracks['track-0']).toBeUndefined();
      return;
    }
    if (first.outcomeKind === 'strong_hit') {
      expect(first.legacyReward).toEqual({ legacy: 'bonds_legacy', ticks: 2 });
      expect(state().tracks['track-0']).toBeUndefined();
      return;
    }
    expect(state().tracks['track-0']).toBeDefined();
  });

  it('make_move attaches enhancements from enabled abilities (M5)', () => {
    const { ctx } = testExecutor(undefined, 31);
    const ship = addAsset(ctx, { asset_id: STARSHIP });
    legacy(ctx, { legacy: 'quests_legacy', ticks: 8 });
    const unlocked = executeToolCall(
      'enable_ability',
      JSON.stringify({ asset_id: ship, ability_index: 2, pay_with_experience: true }),
      ctx,
    );
    expect(unlocked.ok).toBe(true);
    const withstood = executeToolCall(
      'make_move',
      JSON.stringify({ move_id: 'starforged/moves/suffer/withstand_damage', asset_id: ship }),
      ctx,
    );
    expect(withstood.ok).toBe(true);
    if (!withstood.ok) return;
    const payload = withstood.payload as {
      enhancements?: Array<{ assetId: string; abilityIndex: number }>;
    };
    expect(payload.enhancements?.[0]).toMatchObject({ assetId: STARSHIP, abilityIndex: 2 });
  });

  it('raise_shields (embedded move) resolves with wits or the attached vehicle integrity', () => {
    const { ctx } = testExecutor(undefined, 31);
    const ship = addAsset(ctx, { asset_id: STARSHIP });
    addAsset(ctx, { asset_id: SHIELDS, attach_to: ship });
    const byStat = executeToolCall(
      'make_move',
      JSON.stringify({
        move_id: 'starforged/assets/module/shields/abilities/0/moves/raise_shields',
        stat: 'wits',
      }),
      ctx,
    );
    expect(byStat.ok).toBe(true);
    if (!byStat.ok) return;
    expect((byStat.payload as { engineOutcome?: { kind: string } }).engineOutcome?.kind).toBe(
      'action_roll',
    );
    const byAttachment = executeToolCall(
      'make_move',
      JSON.stringify({
        move_id: 'starforged/assets/module/shields/abilities/0/moves/raise_shields',
        asset_id: ship,
      }),
      ctx,
    );
    expect(byAttachment.ok).toBe(true);
    if (!byAttachment.ok) return;
    expect(
      (byAttachment.payload as { engineOutcome?: { baseValue?: number } }).engineOutcome?.baseValue,
    ).toBe(5);
  });

  it('seek_safe_haven rolls against discoveries_legacy (special_track, M5)', () => {
    const { ctx } = testExecutor(undefined, 31);
    const rolled = executeToolCall(
      'make_move',
      JSON.stringify({
        move_id: 'starforged/assets/deed/vanguard/abilities/0/moves/seek_safe_haven',
      }),
      ctx,
    );
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    const payload = rolled.payload as { engineOutcome?: { trackId?: string } };
    expect(payload.engineOutcome?.trackId).toBe('discoveries_legacy');
  });
});

describe('tool argument normalization (GLM/Qwen gateways, M5)', () => {
  it('parses <arg_key>/<arg_value> tag sequences into standard arguments', () => {
    const { ctx, state } = testExecutor(undefined, 5);
    // regression: real GLM-style set_flag call that failed with invalid_input
    const args =
      'set_flag<arg_key>key</arg_key><arg_value>heirloom_locket</arg_value>' +
      '<arg_key>value</arg_key><arg_value>{"description": "A sealed locket of dark hull-metal", "holder": "Captain Ondree Vail"}</arg_value>';
    const execution = executeToolCall('set_flag', args, ctx);
    expect(execution.ok, JSON.stringify(execution)).toBe(true);
    if (!execution.ok) return;
    expect(execution.payload).toMatchObject({ kind: 'set_flag', key: 'heirloom_locket' });
    expect(state().scene.flags['heirloom_locket']).toEqual({
      description: 'A sealed locket of dark hull-metal',
      holder: 'Captain Ondree Vail',
    });
  });

  it('parses repeated-key {"arg_key": ..., "arg_value": ...} JSON arguments', () => {
    const { ctx, state } = testExecutor(undefined, 5);
    // a plain JSON.parse keeps only the last duplicate key, losing the pair
    const args =
      '{"arg_key": "key", "arg_value": "rival_captain", "arg_key": "value", "arg_value": {"name": "Sera Voss", "cargo": ["chart", "relic"]}}';
    const execution = executeToolCall('set_flag', args, ctx);
    expect(execution.ok, JSON.stringify(execution)).toBe(true);
    if (!execution.ok) return;
    expect(execution.payload).toMatchObject({ kind: 'set_flag', key: 'rival_captain' });
    expect(state().scene.flags['rival_captain']).toEqual({
      name: 'Sera Voss',
      cargo: ['chart', 'relic'],
    });
  });

  it('standard JSON arguments are untouched and invalid JSON still fails', () => {
    const { ctx } = testExecutor(undefined, 5);
    const ok = executeToolCall('set_flag', JSON.stringify({ key: 'k', value: 1 }), ctx);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.payload).toMatchObject({ key: 'k', value: 1 });
    const bad = executeToolCall('set_flag', '{key: value}', ctx);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('invalid_json');
  });
});

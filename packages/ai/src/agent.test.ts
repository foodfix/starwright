import { describe, expect, it } from 'vitest';
import { runTurn, trimHistory, extractRecaps, recapMessage, type TurnToolRecord } from './agent.js';
import {
  contentFrames,
  doneFrame,
  frame,
  jsonResponse,
  sseResponse,
  toolCallFrames,
  usageFrame,
  type ScriptedToolCall,
} from './test-support.js';
import type { ChatMessage, FetchImpl, LlmConfig } from './types.js';
import { testExecutor } from './test-support.js';

const CONFIG: LlmConfig = {
  baseUrl: 'https://llm.example.com/v1',
  apiKey: 'sk-test',
  model: 'fake',
};

interface Round {
  text?: string;
  reasoning?: string;
  toolCalls?: ScriptedToolCall[];
  usage?: [number, number];
}

function reasoningFrames(text: string): string[] {
  const frames: string[] = [];
  for (let i = 0; i < text.length; i += 9) {
    frames.push(frame({ choices: [{ delta: { reasoning_content: text.slice(i, i + 9) } }] }));
  }
  return frames;
}

function streamFromRound(round: Round): Response {
  if (round.toolCalls) {
    const frames = [
      ...(round.reasoning ? reasoningFrames(round.reasoning) : []),
      ...(round.text ? contentFrames(round.text) : []),
      ...toolCallFrames(round.toolCalls),
    ];
    if (round.usage) frames.push(usageFrame(round.usage[0], round.usage[1]));
    frames.push(doneFrame);
    return sseResponse(frames);
  }
  const frames = [
    ...(round.reasoning ? reasoningFrames(round.reasoning) : []),
    ...contentFrames(round.text ?? ''),
  ];
  if (round.usage) frames.push(usageFrame(round.usage[0], round.usage[1]));
  frames.push(doneFrame);
  return sseResponse(frames);
}

function scriptedFetch(rounds: Round[]): {
  fetchImpl: FetchImpl;
  bodies: Array<Record<string, unknown>>;
} {
  const bodies: Array<Record<string, unknown>> = [];
  let index = 0;
  const fetchImpl: FetchImpl = (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const round = rounds[index];
    index += 1;
    if (!round) throw new Error('fake model script exhausted');
    return Promise.resolve(streamFromRound(round));
  };
  return { fetchImpl, bodies };
}

function toolRecordByName(records: TurnToolRecord[], name: string): TurnToolRecord[] {
  return records.filter((record) => record.name === name);
}

describe('runTurn (pseudo-model integration)', () => {
  it('runs vow → Face Danger → oracle → meter → end_scene with engine-authoritative state', async () => {
    const { ctx, state } = testExecutor(undefined, 20260915);
    const rounds: Round[] = [
      {
        toolCalls: [
          {
            id: 'c1',
            name: 'swear_vow',
            arguments: '{"title":"Find my missing sister","rank":"dangerous"}',
          },
        ],
        usage: [900, 40],
      },
      {
        toolCalls: [
          {
            id: 'c2',
            name: 'make_move',
            arguments: '{"move_id":"starforged/moves/quest/swear_an_iron_vow","stat":"heart"}',
          },
        ],
        usage: [1400, 60],
      },
      {
        toolCalls: [
          {
            id: 'c3',
            name: 'roll_oracle',
            arguments: '{"table_id":"starforged/oracles/core/action"}',
          },
        ],
        usage: [1800, 30],
      },
      {
        toolCalls: [{ id: 'c4', name: 'adjust_meter', arguments: '{"meter":"spirit","delta":-1}' }],
        usage: [2100, 25],
      },
      { toolCalls: [{ id: 'c5', name: 'end_scene', arguments: '{}' }], usage: [2400, 20] },
      {
        text: 'You swear the vow. The landing bay lights flicker as danger closes in.',
        usage: [2600, 30],
      },
    ];
    const { fetchImpl, bodies } = scriptedFetch(rounds);
    const result = await runTurn({
      config: CONFIG,
      history: [],
      userInput: 'I swear to find my sister, then head into the danger zone.',
      executor: ctx,
      language: 'en',
      fetchImpl,
    });

    // every request carries tools until the turn ends; system message rebuilt per turn
    expect(bodies.length).toBe(6);
    for (const body of bodies) {
      const messages = body['messages'] as ChatMessage[];
      expect(messages[0]?.role).toBe('system');
      expect(String(messages[0]?.content)).toContain('MOVE CATALOG');
    }

    // engine state: vow track (0 ticks — bonus marks are applied by the model
    // via tools) + face danger settlement + meter + scene advanced
    const tracks = Object.values(state().tracks);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ kind: 'vow', rank: 'dangerous', ticks: 0 });
    const kinds = state().journal.map((entry) => entry.outcome?.kind);
    expect(kinds).toEqual(['add_track', 'action_roll', 'adjust_meter', 'end_scene']);
    expect(state().scene.index).toBe(2);
    expect(state().characters[0]?.meters.spirit).toBe(4);

    // tool protocol: each engine call answered the model with results
    expect(result.toolCalls.map((r) => r.name)).toEqual([
      'swear_vow',
      'make_move',
      'roll_oracle',
      'adjust_meter',
      'end_scene',
    ]);
    const moveRecord = toolRecordByName(result.toolCalls, 'make_move')[0];
    const movePayload = (moveRecord?.execution.ok ? moveRecord.execution.payload : null) as {
      outcomeKind: string;
    } | null;
    expect(movePayload?.outcomeKind).toBeDefined();
    expect(moveRecord?.content).toContain('"outcomeKind"');

    // usage accumulated over all rounds
    expect(result.usage.promptTokens).toBe(900 + 1400 + 1800 + 2100 + 2400 + 2600);
    // returned history: user + assistant(tool_calls) + tool pairs + final assistant (no system)
    expect(result.messages[0]?.role).toBe('user');
    expect(result.messages.at(-1)?.role).toBe('assistant');
    expect(result.messages.at(-1)?.content).toContain('landing bay');
    expect(result.error).toBeUndefined();
  });

  it('lets the model self-correct after a failed tool call', async () => {
    const { ctx } = testExecutor(undefined, 5);
    const rounds: Round[] = [
      {
        toolCalls: [
          { id: 'c1', name: 'make_move', arguments: '{"move_id":"face_danger","stat":"wits"}' },
        ],
      },
      {
        toolCalls: [
          {
            id: 'c2',
            name: 'make_move',
            arguments: '{"move_id":"starforged/moves/adventure/face_danger","stat":"wits"}',
          },
        ],
      },
      { text: 'You navigate the conduit safely.' },
    ];
    const { fetchImpl } = scriptedFetch(rounds);
    const result = await runTurn({
      config: CONFIG,
      history: [],
      userInput: 'I crawl through the plasma conduit.',
      executor: ctx,
      language: 'en',
      fetchImpl,
    });
    const attempts = toolRecordByName(result.toolCalls, 'make_move');
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.execution.ok).toBe(false);
    expect(JSON.parse(attempts[0]?.content ?? '{}').error.code).toBe('unknown_move');
    expect(attempts[1]?.execution.ok).toBe(true);
  });

  it('enforces the tool budget: final request drops tools and demands a wrap-up', async () => {
    const { ctx } = testExecutor(undefined, 9);
    const rounds: Round[] = [
      { toolCalls: [{ id: 'c1', name: 'adjust_momentum', arguments: '{"delta":1}' }] },
      { toolCalls: [{ id: 'c2', name: 'set_flag', arguments: '{"key":"alert","value":true}' }] },
      {
        toolCalls: [{ id: 'c3', name: 'end_scene', arguments: '{}' }],
        text: 'trying to sneak a tool call',
      },
      { text: 'Wrapping up without tools.' },
    ];
    const { fetchImpl, bodies } = scriptedFetch(rounds);
    const result = await runTurn({
      config: CONFIG,
      history: [],
      userInput: 'continue',
      executor: ctx,
      language: 'en',
      toolBudget: 2,
      fetchImpl,
    });
    // requests 1-2 offer tools; after the second execution the budget is
    // announced, so requests 3+ drop tools entirely. The model's sneaky third
    // call is refused without executing, and the wrap-up request succeeds.
    expect(bodies[0]).toHaveProperty('tools');
    expect(bodies[1]).toHaveProperty('tools');
    expect(bodies[2]).not.toHaveProperty('tools');
    expect(bodies[3]).not.toHaveProperty('tools');
    expect(toolRecordByName(result.toolCalls, 'end_scene')).toHaveLength(0);
    expect(result.truncatedByBudget).toBe(true);
    expect(ctx.getState().momentum).toBe(3);
    // refusal tool message kept the protocol pairing valid
    const refusals = result.messages.filter(
      (m) => m.role === 'tool' && (m.content ?? '').includes('tool_budget_exhausted'),
    );
    expect(refusals).toHaveLength(1);
    // the turn-local budget notice is not leaked into rolling history
    expect(result.messages.some((m) => m.role === 'system')).toBe(false);
  });

  it('records every request/response exchange in interactions', async () => {
    const { ctx } = testExecutor(undefined, 77);
    const rounds: Round[] = [
      {
        reasoning: 'Need to swear the vow first.',
        toolCalls: [
          {
            id: 'c1',
            name: 'swear_vow',
            arguments: '{"title":"Find my sister","rank":"troublesome"}',
          },
        ],
      },
      { reasoning: 'Now wrap up.', text: 'The vow is sworn.' },
    ];
    const { fetchImpl } = scriptedFetch(rounds);
    const requests: Array<{ round: number; roles: string[]; toolCount: number }> = [];
    const reasoningDeltas: string[] = [];
    const result = await runTurn({
      config: CONFIG,
      history: [],
      userInput: 'I swear to find her.',
      executor: ctx,
      language: 'en',
      fetchImpl,
      onRequest: ({ round, messages, tools }) => {
        requests.push({
          round,
          roles: messages.map((m) => m.role),
          toolCount: tools ? tools.length : 0,
        });
      },
      onReasoningDelta: (text) => reasoningDeltas.push(text),
    });

    // two rounds → two audit records
    expect(result.interactions).toHaveLength(2);
    // round 0: exact snapshot of what was sent (system + user) plus tools
    const first = result.interactions[0];
    if (!first) throw new Error('missing first interaction');
    expect(first.round).toBe(0);
    expect(first.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(first.tools).toHaveLength(26);
    expect(first.reasoning).toBe('Need to swear the vow first.');
    expect(first.content).toBe('');
    expect(first.toolCalls).toHaveLength(1);
    // round 1: sent messages already include the tool exchange, response is final text
    const second = result.interactions[1];
    if (!second) throw new Error('missing second interaction');
    expect(second.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(second.reasoning).toBe('Now wrap up.');
    expect(second.content).toBe('The vow is sworn.');
    expect(second.toolCalls).toHaveLength(0);
    expect(second.finishReason).toBeNull();

    // onRequest fired before each request with the same snapshots
    expect(requests.map((r) => r.round)).toEqual([0, 1]);
    expect(requests[0]?.roles).toEqual(['system', 'user']);
    expect(requests[1]?.roles).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(requests[1]?.toolCount).toBe(26);
    // reasoning deltas streamed live
    expect(reasoningDeltas.join('')).toBe('Need to swear the vow first.Now wrap up.');
  });

  it('omits tools in wrap-up interactions and records failed requests', async () => {
    const { ctx } = testExecutor(undefined, 9);
    const rounds: Round[] = [
      { toolCalls: [{ id: 'c1', name: 'adjust_momentum', arguments: '{"delta":1}' }] },
      { toolCalls: [{ id: 'c2', name: 'set_flag', arguments: '{"key":"alert","value":true}' }] },
      { toolCalls: [{ id: 'c3', name: 'end_scene', arguments: '{}' }] },
      { text: 'Wrapping up.' },
    ];
    const { fetchImpl } = scriptedFetch(rounds);
    const result = await runTurn({
      config: CONFIG,
      history: [],
      userInput: 'continue',
      executor: ctx,
      language: 'en',
      toolBudget: 2,
      fetchImpl,
    });
    expect(result.interactions).toHaveLength(4);
    const sneaky = result.interactions[2];
    const final = result.interactions[3];
    if (!sneaky || !final) throw new Error('missing wrap-up interactions');
    expect(sneaky.tools).toBeUndefined();
    // the sneaky end_scene came back on a tools-less request and is audited
    expect(sneaky.toolCalls.map((c) => c.function.name)).toEqual(['end_scene']);
    expect(final.tools).toBeUndefined();
    expect(final.content).toBe('Wrapping up.');
  });

  it('returns an error diagnostic while keeping history well-formed', async () => {
    const { ctx } = testExecutor();
    const fetchImpl: FetchImpl = () =>
      Promise.resolve(jsonResponse({ error: { message: 'quota exceeded' } }, 429));
    const result = await runTurn({
      config: CONFIG,
      history: [],
      userInput: 'hello',
      executor: ctx,
      language: 'en',
      fetchImpl,
    });
    expect(result.error?.code).toBe('rate_limited');
    expect(result.messages.at(-1)?.role).toBe('user');
    // the failed request is still audited with the diagnostic attached
    const failed = result.interactions[0];
    expect(failed?.error?.code).toBe('rate_limited');
    expect(failed?.messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('never lets prose change state (INV-1/2)', async () => {
    const { ctx, state } = testExecutor(undefined, 3);
    const rounds: Round[] = [
      { text: 'You take 3 damage and your health drops to 2. The oracle says yes.' },
    ];
    const { fetchImpl } = scriptedFetch(rounds);
    await runTurn({
      config: CONFIG,
      history: [],
      userInput: 'I get hit!',
      executor: ctx,
      language: 'en',
      fetchImpl,
    });
    const after = state();
    expect(after.characters[0]?.meters.health).toBe(5);
    expect(after.journal).toHaveLength(0);
    expect(after.seq).toBe(0);
  });
});

describe('trimHistory', () => {
  const user = (text: string): ChatMessage => ({ role: 'user', content: text });
  const assistantWithCalls = (ids: string[]): ChatMessage => ({
    role: 'assistant',
    content: null,
    tool_calls: ids.map((id) => ({
      id,
      type: 'function' as const,
      function: { name: 'x', arguments: '{}' },
    })),
  });
  const toolMsg = (id: string): ChatMessage => ({ role: 'tool', content: '{}', tool_call_id: id });

  it('keeps the tail intact under the limit', () => {
    const history = [user('a'), user('b')];
    expect(trimHistory(history, 5)).toEqual(history);
  });

  it('drops leading orphan tool messages at the cut boundary', () => {
    const history = [user('a'), user('b'), toolMsg('c1')];
    const trimmed = trimHistory(history, 2);
    expect(trimmed.map((m) => m.role)).toEqual(['user', 'tool']);
  });

  it('skips an assistant tool_calls group whose replies were cut off', () => {
    const history = [user('a'), assistantWithCalls(['t1', 't2']), toolMsg('t1')];
    const trimmed = trimHistory(history, 2);
    // the only candidate tail is an incomplete tool_calls group; drop it all
    expect(trimmed).toEqual([]);
  });

  it('keeps a complete tool_calls group at the boundary', () => {
    const history = [user('a'), assistantWithCalls(['t1']), toolMsg('t1'), user('b')];
    const trimmed = trimHistory(history, 3);
    expect(trimmed.map((m) => m.role)).toEqual(['assistant', 'tool', 'user']);
  });
});

describe('recap (history compression)', () => {
  const user = (text: string): ChatMessage => ({ role: 'user', content: text });
  const assistant = (text: string): ChatMessage => ({ role: 'assistant', content: text });

  it('extracts one line per complete <summary> block, skipping other roles', () => {
    const cut: ChatMessage[] = [
      assistant('Earlier.\n<summary>first turn recap</summary>'),
      user('hi'),
      assistant('Mid.\n<summary>second turn recap</summary>'),
      { role: 'tool', content: '{}', tool_call_id: 't1' },
    ];
    expect(extractRecaps(cut)).toEqual(['first turn recap', 'second turn recap']);
  });

  it('caps the recap message at the 20 latest lines', () => {
    const many = Array.from({ length: 25 }, (_, i) => assistant(`<summary>recap ${i + 1}</summary>`));
    const message = recapMessage(many, 'en');
    expect(message).not.toBeNull();
    const lines = String(message?.content).split('\n');
    expect(lines).toHaveLength(21);
    expect(lines[0]).toContain('STORY SO FAR');
    expect(lines[1]).toContain('recap 6');
    expect(String(message?.content)).not.toContain('recap 5');
  });

  it('skips messages without a block and returns null when none found', () => {
    const cut = [assistant('no block here'), user('x')];
    expect(recapMessage(cut, 'en')).toBeNull();
    expect(recapMessage(cut, 'zh')).toBeNull();
  });

  it('localizes the recap title to the narrative language', () => {
    const message = recapMessage([assistant('<summary>概括</summary>')], 'zh');
    expect(String(message?.content)).toContain('前情提要');
    expect(String(message?.content)).toContain('- 概括');
  });

  it('injects a turn-local recap when history is trimmed; returned history stays recap-free', async () => {
    const { ctx } = testExecutor(undefined, 20260915);
    const history: ChatMessage[] = [];
    for (let i = 0; i < 6; i += 1) {
      history.push(user(`input ${i + 1}`));
      history.push(assistant(`narration ${i + 1}\n<summary>recap of turn ${i + 1}</summary>`));
    }
    const { fetchImpl, bodies } = scriptedFetch([{ text: 'Done.' }]);
    const result = await runTurn({
      config: CONFIG,
      history,
      userInput: 'next action',
      executor: ctx,
      language: 'en',
      maxHistoryMessages: 4,
      fetchImpl,
    });
    const sent = bodies[0]?.['messages'] as ChatMessage[];
    expect(sent).toHaveLength(7);
    expect(sent[0]?.role).toBe('system');
    expect(sent[1]?.role).toBe('system');
    expect(String(sent[1]?.content)).toContain('STORY SO FAR');
    expect(String(sent[1]?.content)).toContain('recap of turn 1');
    expect(String(sent[1]?.content)).toContain('recap of turn 4');
    expect(String(sent[1]?.content)).not.toContain('recap of turn 5');
    expect(sent.slice(2).map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    // the recap is rebuilt per turn and never persisted into rolling history,
    // but the trimmed-out messages stay in the returned history for future recaps
    expect(JSON.stringify(result.messages)).not.toContain('STORY SO FAR');
    expect(result.messages).toHaveLength(14);
    expect(String(result.messages[1]?.content)).toContain('recap of turn 1');
  });

  it('injects nothing extra when the cut region has no summaries', async () => {
    const { ctx } = testExecutor(undefined, 20260915);
    const history = Array.from({ length: 6 }, (_, i) => user(`input ${i + 1}`));
    const { fetchImpl, bodies } = scriptedFetch([{ text: 'Done.' }]);
    await runTurn({
      config: CONFIG,
      history,
      userInput: 'next action',
      executor: ctx,
      language: 'en',
      maxHistoryMessages: 4,
      fetchImpl,
    });
    const sent = bodies[0]?.['messages'] as ChatMessage[];
    expect(sent.map((m) => m.role)).toEqual(['system', 'user', 'user', 'user', 'user', 'user']);
  });
});

describe('system prompt shape', () => {
  it('includes snapshot, move and oracle catalogs within a few KB', async () => {
    const { ctx } = testExecutor();
    const rounds: Round[] = [{ text: 'ok' }];
    const { fetchImpl, bodies } = scriptedFetch(rounds);
    await runTurn({
      config: CONFIG,
      history: [],
      userInput: 'start',
      executor: ctx,
      language: 'en',
      fetchImpl,
    });
    const system = String((bodies[0]?.['messages'] as ChatMessage[])[0]?.content);
    expect(system).toContain('CHARACTER Vagrant');
    expect(system).toContain('momentum +2 (max 10, reset 2)');
    expect(system).toContain('starforged/moves/adventure/face_danger | Face Danger | action_roll');
    expect(system).toContain('starforged/oracles/core/action');
    // rough token budget: catalogs are id+name only
    expect(system.length).toBeLessThan(24_000);
  });
});

describe('chinese narration', () => {
  it('injects the zh GM spec when requested', async () => {
    const { ctx } = testExecutor();
    const { fetchImpl, bodies } = scriptedFetch([{ text: '好的' }]);
    await runTurn({
      config: CONFIG,
      history: [],
      userInput: '开始',
      executor: ctx,
      language: 'zh',
      fetchImpl,
    });
    const system = String((bodies[0]?.['messages'] as ChatMessage[])[0]?.content);
    expect(system).toContain('以简体中文叙事');
  });
});

describe('mid-turn abort', () => {
  it('keeps already-executed tool results and returns the diagnostic', async () => {
    const { ctx, state } = testExecutor(undefined, 11);
    let first = true;
    const fetchImpl: FetchImpl = () => {
      if (first) {
        first = false;
        return Promise.resolve(
          sseResponse([
            ...toolCallFrames([{ id: 'c1', name: 'adjust_momentum', arguments: '{"delta":2}' }]),
            doneFrame,
          ]),
        );
      }
      return Promise.reject(new DOMException('stalled', 'AbortError'));
    };
    const result = await runTurn({
      config: CONFIG,
      history: [],
      userInput: 'go',
      executor: ctx,
      language: 'en',
      fetchImpl,
    });
    expect(result.error?.code).toBe('aborted');
    expect(result.toolCalls).toHaveLength(1);
    expect(state().momentum).toBe(4); // executed tool persisted
    // the executed tool result was already answered, so the history tail is
    // the engine payload — valid for the next turn without sealing
    const last = result.messages.at(-1);
    expect(last?.role).toBe('tool');
    expect(last?.content).toContain('"kind":"adjust_momentum"');
  });
});

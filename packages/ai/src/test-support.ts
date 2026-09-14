import { readFileSync } from 'node:fs';
import { loadStarforged } from '@starwright/data';
import { createNewCampaign, mulberry32, type CampaignState } from '@starwright/engine';
import type { ExecutorContext } from './executor.js';

const raw: unknown = JSON.parse(
  readFileSync(new URL('../../../data/starforged.json', import.meta.url), 'utf8'),
);

const loaded = loadStarforged(raw);
export const realIndex = loaded.index;

export function testCampaign(): CampaignState {
  return createNewCampaign({
    characterName: 'Vagrant',
    stats: { edge: 3, heart: 2, iron: 2, shadow: 1, wits: 1 },
  });
}

export function testExecutor(
  state: CampaignState = testCampaign(),
  seed = 20260915,
): { ctx: ExecutorContext; state(): CampaignState } {
  let current = state;
  const ctx: ExecutorContext = {
    index: realIndex,
    rng: mulberry32(seed),
    getState: () => current,
    replaceState: (next) => {
      current = next;
    },
  };
  return { ctx, state: () => current };
}

/* ---------- SSE stream helpers ---------- */

const encoder = new TextEncoder();

export function sseResponse(frames: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function contentFrames(text: string, splitEvery = 7): string[] {
  const frames: string[] = [];
  for (let i = 0; i < text.length; i += splitEvery) {
    frames.push(frame({ choices: [{ delta: { content: text.slice(i, i + splitEvery) } }] }));
  }
  return frames;
}

export interface ScriptedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** tool_calls streamed in two argument fragments + a finish_reason frame */
export function toolCallFrames(calls: ScriptedToolCall[]): string[] {
  const frames: string[] = [
    frame({
      choices: [
        {
          delta: {
            tool_calls: calls.map((call, index) => ({
              index,
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: '' },
            })),
          },
        },
      ],
    }),
  ];
  const halves = calls.map((call) => {
    const mid = Math.ceil(call.arguments.length / 2);
    return [call.arguments.slice(0, mid), call.arguments.slice(mid)] as const;
  });
  for (const part of [0, 1]) {
    frames.push(
      frame({
        choices: [
          {
            delta: {
              tool_calls: calls.map((_call, index) => {
                const half = halves[index];
                if (!half) throw new Error('halves/index mismatch');
                return {
                  index,
                  function: { arguments: half[part] },
                };
              }),
            },
          },
        ],
      }),
    );
  }
  frames.push(frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
  return frames;
}

export function usageFrame(promptTokens: number, completionTokens: number): string {
  return frame({
    choices: [],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  });
}

export const doneFrame = 'data: [DONE]\n\n';

import { describe, expect, it } from 'vitest';
import { SseParser } from './sse.js';
import { doneFrame, frame, toolCallFrames, usageFrame } from './test-support.js';

function feedAll(parser: SseParser, chunks: string[]): void {
  for (const chunk of chunks) parser.feed(chunk);
}

describe('SseParser', () => {
  it('aggregates content deltas across chunk boundaries', () => {
    const parser = new SseParser();
    const text = 'The derelict groans as you board her.';
    // split the SSE stream at awkward byte positions (mid-frame)
    const stream = text
      .split(/(?<=^| )/)
      .map((word) => frame({ choices: [{ delta: { content: word } }] }))
      .join('');
    feedAll(parser, [stream.slice(0, 13), stream.slice(13, 40), stream.slice(40)]);
    parser.feed('\n');
    expect(parser.aggregation.content).toBe(text);
    expect(parser.done).toBe(false);
  });

  it('stops at [DONE] and ignores later frames', () => {
    const parser = new SseParser();
    parser.feed(frame({ choices: [{ delta: { content: 'Hi' } }] }));
    parser.feed(doneFrame);
    parser.feed(frame({ choices: [{ delta: { content: 'more' } }] }));
    expect(parser.done).toBe(true);
    expect(parser.aggregation.content).toBe('Hi');
  });

  it('ignores comment and empty lines', () => {
    const parser = new SseParser();
    parser.feed(': keep-alive ping\n\n');
    parser.feed(frame({ choices: [{ delta: { content: 'x' } }] }));
    expect(parser.aggregation.content).toBe('x');
  });

  it('tolerates malformed JSON frames', () => {
    const parser = new SseParser();
    parser.feed('data: {not json}\n');
    parser.feed(frame({ choices: [{ delta: { content: 'ok' } }] }));
    expect(parser.aggregation.content).toBe('ok');
  });

  it('handles CRLF line endings', () => {
    const parser = new SseParser();
    parser.feed(`data: ${JSON.stringify({ choices: [{ delta: { content: 'a' } }] })}\r\n`);
    parser.feed('\r\n');
    parser.feed(doneFrame.replace('\n\n', '\r\n'));
    expect(parser.aggregation.content).toBe('a');
    expect(parser.done).toBe(true);
  });

  it('merges tool_calls split across frames by index (arguments concat)', () => {
    const parser = new SseParser();
    const [f1, f2, f3, f4] = toolCallFrames([
      {
        id: 'call_a',
        name: 'make_move',
        arguments: '{"move_id":"starforged/moves/adventure/face_danger","stat":"wits"}',
      },
    ]);
    if (!f1 || !f2 || !f3 || !f4) throw new Error('expected four frames');
    // interleave a second call announced after the first (out-of-order indexes)
    feedAll(parser, [f1, f2]);
    parser.feed(
      frame({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: 'call_b',
                  type: 'function',
                  function: { name: 'roll_oracle', arguments: '{"table_' },
                },
              ],
            },
          },
        ],
      }),
    );
    feedAll(parser, [f3, f4]);
    parser.feed(
      frame({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, function: { arguments: 'id":"starforged/oracles/core/action"}' } },
              ],
            },
          },
        ],
      }),
    );
    parser.feed(doneFrame);

    const calls = [...parser.aggregation.toolCalls.entries()].sort(([a], [b]) => a - b);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1]).toMatchObject({
      id: 'call_a',
      function: {
        name: 'make_move',
        arguments: '{"move_id":"starforged/moves/adventure/face_danger","stat":"wits"}',
      },
    });
    expect(calls[1]?.[1]).toMatchObject({
      id: 'call_b',
      function: {
        name: 'roll_oracle',
        arguments: '{"table_id":"starforged/oracles/core/action"}',
      },
    });
    expect(parser.aggregation.finishReason).toBe('tool_calls');
  });

  it('captures usage reported on a trailing frame', () => {
    const parser = new SseParser();
    parser.feed(frame({ choices: [{ delta: { content: 'y' } }] }));
    parser.feed(usageFrame(120, 34));
    parser.feed(doneFrame);
    expect(parser.aggregation.usage).toEqual({ promptTokens: 120, completionTokens: 34 });
  });

  it('aggregates reasoning_content and reasoning deltas separately from content', () => {
    const parser = new SseParser();
    parser.feed(frame({ choices: [{ delta: { reasoning_content: 'think ' } }] }));
    parser.feed(frame({ choices: [{ delta: { reasoning: 'hard, ' } }] }));
    parser.feed(frame({ choices: [{ delta: { content: 'Hi' } }] }));
    parser.feed(doneFrame);
    expect(parser.aggregation.reasoning).toBe('think hard, ');
    expect(parser.aggregation.content).toBe('Hi');
  });

  it('captures reasoning from a non-streaming shaped message', () => {
    const parser = new SseParser();
    parser.feed(
      frame({
        choices: [
          { message: { content: 'answer', reasoning_content: 'why' }, finish_reason: 'stop' },
        ],
      }),
    );
    parser.feed(doneFrame);
    expect(parser.aggregation.reasoning).toBe('why');
    expect(parser.aggregation.content).toBe('answer');
  });

  it('keeps the latest usage when several frames carry it', () => {
    const parser = new SseParser();
    parser.feed(
      frame({ choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    );
    parser.feed(
      frame({ choices: [{ delta: {} }], usage: { prompt_tokens: 12, completion_tokens: 6 } }),
    );
    expect(parser.aggregation.usage).toEqual({ promptTokens: 12, completionTokens: 6 });
  });
});

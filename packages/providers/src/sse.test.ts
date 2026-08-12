import { describe, expect, it } from 'vitest';
import { parseSseStream, sseStreamOf } from './sse.js';

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

describe('parseSseStream', () => {
  it('解析 event/id/data 字段', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('id: 7\nevent: answer\ndata: {"x":1}\n\n'));
        controller.close();
      },
    });
    await expect(collect(parseSseStream(body))).resolves.toEqual([
      { id: '7', event: 'answer', data: '{"x":1}' },
    ]);
  });

  it('跨 chunk 拼接并忽略注释心跳', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': ping\n\ndata: first'));
        controller.enqueue(encoder.encode('\n\ndata: second\n\n'));
        controller.close();
      },
    });
    await expect(collect(parseSseStream(body))).resolves.toEqual([
      { event: undefined, id: undefined, data: 'first' },
      { event: undefined, id: undefined, data: 'second' },
    ]);
  });

  it('支持多行 data', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: line1\ndata: line2\n\n'));
        controller.close();
      },
    });
    await expect(collect(parseSseStream(body))).resolves.toEqual([
      { event: undefined, id: undefined, data: 'line1\nline2' },
    ]);
  });

  it('sseStreamOf 生成可解析流', async () => {
    const frames = await collect(parseSseStream(sseStreamOf([{ event: 'x', data: { ok: true } }])));
    expect(frames).toEqual([{ event: 'x', id: undefined, data: '{"ok":true}' }]);
  });
});

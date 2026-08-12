/** 无依赖 SSE 解析器，适配 OpenAI/xAI Responses 与 Anthropic Messages 流。 */
export interface SseMessage {
  event?: string;
  data: string;
  id?: string;
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    const parsed = parseFrame(buffer);
    if (parsed) yield parsed;
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): SseMessage | null {
  if (!frame.trim() || frame.startsWith(':')) return null;
  let event: string | undefined;
  let id: string | undefined;
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id') id = value;
  }
  if (!data.length) return null;
  return { event, id, data: data.join('\n') };
}

/** 测试和 Mock HTTP 用：把事件数组编码成 ReadableStream。 */
export function sseStreamOf(frames: Array<{ event?: string; data: unknown }>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        const eventLine = frame.event ? `event: ${frame.event}\n` : '';
        controller.enqueue(encoder.encode(`${eventLine}data: ${JSON.stringify(frame.data)}\n\n`));
      }
      controller.close();
    },
  });
}

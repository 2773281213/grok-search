import { SSE_HEARTBEAT, TERMINAL_STATUSES, encodeSseFrame, type SearchEvent, type SessionStatus } from '@cairn/shared';
import { getRuntime } from '@/lib/runtime';
import { json, parseAfter } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const { engine } = getRuntime();
  const snapshot = engine.get(id);
  if (!snapshot) return json({ error: '会话不存在' }, { status: 404 });
  const after = parseAfter(request);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: () => void = () => {};
      const timers: { heartbeat?: ReturnType<typeof setInterval> } = {};
      const close = () => {
        if (closed) return;
        closed = true;
        if (timers.heartbeat) clearInterval(timers.heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* 客户端可能已先断开 */ }
      };
      const send = (event: SearchEvent) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(encodeSseFrame(event))); } catch { close(); }
      };

      for (const event of engine.events(id, after)) send(event);
      const current = engine.get(id);
      if (current && TERMINAL_STATUSES.includes(current.status)) {
        close();
        return;
      }

      unsubscribe = engine.subscribe(id, (event) => {
        send(event);
        const terminal = event.type === 'session.completed'
          || event.type === 'session.failed'
          || (event.type === 'session.status'
            && TERMINAL_STATUSES.includes((event.data as { status: SessionStatus }).status));
        if (terminal) queueMicrotask(close);
      });
      timers.heartbeat = setInterval(() => {
        if (!closed) {
          try { controller.enqueue(encoder.encode(SSE_HEARTBEAT)); } catch { close(); }
        }
      }, 15_000);
      request.signal.addEventListener('abort', close, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

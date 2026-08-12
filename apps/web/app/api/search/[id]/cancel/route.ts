import { getRuntime } from '@/lib/runtime';
import { enforceRateLimit, handleApiError, json } from '@/lib/api';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    enforceRateLimit(request);
    const { id } = await context.params;
    const engine = getRuntime().engine;
    const session = engine.get(id);
    if (!session) return json({ error: '会话不存在' }, { status: 404 });
    const cancelled = engine.cancel(id);
    return json({ cancelled, session: engine.get(id) });
  } catch (error) {
    return handleApiError(error);
  }
}

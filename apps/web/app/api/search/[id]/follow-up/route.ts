import { FollowUpSchema, type FollowUpInput } from '@cairn/shared';
import { getRuntime } from '@/lib/runtime';
import { enforceRateLimit, handleApiError, json, readJson } from '@/lib/api';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    enforceRateLimit(request);
    const { id } = await context.params;
    const body = await readJson<FollowUpInput>(request, FollowUpSchema);
    const engine = getRuntime().engine;
    const parent = engine.get(id);
    if (!parent) return json({ error: '父会话不存在' }, { status: 404 });
    const session = engine.start({
      question: body.question,
      mode: parent.mode,
      providers: parent.providerIds,
      options: parent.settings,
    }, { parentId: parent.id });
    return json({ session, streamUrl: `/api/search/${session.id}/stream` }, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}

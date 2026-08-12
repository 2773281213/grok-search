import { getRuntime } from '@/lib/runtime';
import { handleApiError, json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const session = getRuntime().engine.get(id);
    if (!session) return json({ error: '会话不存在' }, { status: 404 });
    return json({ session });
  } catch (error) {
    return handleApiError(error);
  }
}

import { HistoryQuerySchema } from '@cairn/shared';
import { getRuntime } from '@/lib/runtime';
import { handleApiError, json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const query = HistoryQuerySchema.parse(Object.fromEntries(url.searchParams));
    return json({ sessions: getRuntime().engine.history(query.limit, query.q) });
  } catch (error) {
    return handleApiError(error);
  }
}

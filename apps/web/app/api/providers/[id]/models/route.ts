import { ProviderIdSchema } from '@cairn/shared';
import { getRuntime } from '@/lib/runtime';
import { handleApiError, json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: rawId } = await context.params;
    const id = ProviderIdSchema.parse(rawId);
    const provider = getRuntime().providers.get(id);
    if (!provider) return json({ error: 'Provider 未启用' }, { status: 400 });
    if (!provider.configured()) return json({ error: 'API Key 或模型 ID 尚未配置' }, { status: 400 });
    return json({ models: await provider.listModels() });
  } catch (error) {
    return handleApiError(error);
  }
}

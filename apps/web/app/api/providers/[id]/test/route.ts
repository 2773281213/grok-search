import { ProviderIdSchema } from '@cairn/shared';
import { getRuntime } from '@/lib/runtime';
import { enforceRateLimit, handleApiError, json } from '@/lib/api';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    enforceRateLimit(request);
    const { id: rawId } = await context.params;
    const id = ProviderIdSchema.parse(rawId);
    const provider = getRuntime().providers.get(id);
    if (!provider) return json({ error: 'Provider 未启用' }, { status: 400 });
    if (!provider.configured()) return json({ error: 'API Key 或模型 ID 尚未配置' }, { status: 400 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('连接测试超时')), 15_000);
    const started = Date.now();
    try {
      const models = await provider.listModels(controller.signal);
      return json({ ok: true, latencyMs: Date.now() - started, modelCount: models.length, models: models.slice(0, 10) });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return handleApiError(error);
  }
}

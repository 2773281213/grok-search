import { ProviderIdSchema, ProviderSettingsPatchSchema, type ProviderSettingsPatchInput } from '@cairn/shared';
import { getRuntime, resetRuntime } from '@/lib/runtime';
import { enforceRateLimit, handleApiError, json, readJson } from '@/lib/api';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    enforceRateLimit(request);
    const { id: rawId } = await context.params;
    const id = ProviderIdSchema.parse(rawId);
    const patch = await readJson<ProviderSettingsPatchInput>(request, ProviderSettingsPatchSchema);
    const runtime = getRuntime();
    const current = runtime.repo.getProviderSettings(id) ?? {
      enabled: true,
      ...runtime.providers.require(id).configStatus(),
    };
    const value = {
      enabled: patch.enabled ?? current.enabled,
      defaultModel: patch.defaultModel === '' ? undefined : patch.defaultModel ?? current.defaultModel,
      baseUrl: patch.baseUrl === '' ? undefined : patch.baseUrl ?? current.baseUrl,
      timeoutMs: patch.timeoutMs ?? current.timeoutMs,
    };
    runtime.repo.setProviderSettings(id, value);
    await resetRuntime();
    return json({ providerId: id, settings: value });
  } catch (error) {
    return handleApiError(error);
  }
}

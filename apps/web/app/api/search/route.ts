import { SearchRequestSchema, type ProviderId, type RoleModelConfig, type SearchRequestInput } from '@cairn/shared';
import { getRuntime } from '@/lib/runtime';
import { enforceRateLimit, handleApiError, json, readJson } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    enforceRateLimit(request);
    const input = await readJson<SearchRequestInput>(request, SearchRequestSchema);
    const { repo, engine } = getRuntime();
    const app = repo.getAppSettings();
    const enriched: SearchRequestInput = {
      ...input,
      mode: input.mode ?? app.defaultMode,
      providers: input.providers?.length
        ? input.providers
        : input.mode === 'panel'
          ? undefined
          : app.roles.researcher?.providerId
            ? [app.roles.researcher.providerId]
            : undefined,
      options: {
        ...input.options,
        plannerProviderId: input.options?.plannerProviderId ?? app.roles.planner?.providerId,
        synthesizerProviderId: input.options?.synthesizerProviderId ?? app.roles.synthesizer?.providerId,
        judgeProviderId: input.options?.judgeProviderId ?? app.roles.judge?.providerId,
        models: roleModels(app.roles, input.options?.models),
      },
    };
    const session = engine.start(enriched);
    return json({ session, streamUrl: `/api/search/${session.id}/stream` }, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}

function roleModels(
  roles: RoleModelConfig,
  requested?: Partial<Record<ProviderId, string>>,
): Partial<Record<ProviderId, string>> | undefined {
  const models: Partial<Record<ProviderId, string>> = { ...requested };
  for (const role of [roles.planner, roles.researcher, roles.synthesizer, roles.judge]) {
    if (role?.model && !models[role.providerId]) models[role.providerId] = role.model;
  }
  return Object.keys(models).length ? models : undefined;
}

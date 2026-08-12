import { getRuntime } from '@/lib/runtime';
import { handleApiError, json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const { providers } = getRuntime();
    const available = providers
      .all()
      .filter(({ provider, enabled }) => enabled && provider.configured())
      .map(({ provider }) => provider.id);

    return json({
      ok: true,
      service: 'cairn',
      availableProviders: available,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

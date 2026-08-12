import { getRuntime } from '@/lib/runtime';
import { handleApiError, json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const { providers } = getRuntime();
    return json({
      providers: providers.all().map(({ provider, enabled }) => ({
        id: provider.id,
        label: provider.label,
        enabled,
        configured: provider.configured(),
        capabilities: provider.capabilities(),
        config: provider.configStatus(),
        simulated: provider.configStatus().baseUrl.startsWith('mock:'),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

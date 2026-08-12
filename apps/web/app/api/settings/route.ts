import { AppSettingsSchema, type AppSettings } from '@cairn/shared';
import { getRuntime } from '@/lib/runtime';
import { enforceRateLimit, handleApiError, json, readJson } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    return json({ settings: getRuntime().repo.getAppSettings() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    enforceRateLimit(request);
    const settings = await readJson<AppSettings>(request, AppSettingsSchema);
    getRuntime().repo.setAppSettings(settings);
    return json({ settings });
  } catch (error) {
    return handleApiError(error);
  }
}

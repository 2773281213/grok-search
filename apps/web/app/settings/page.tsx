import type { Metadata } from 'next';
import { SettingsConsole } from '@/components/settings-console';

export const metadata: Metadata = { title: 'Provider 设置' };
export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return <SettingsConsole />;
}

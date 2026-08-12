import type { Metadata } from 'next';
import { HistoryList } from '@/components/history-list';

export const metadata: Metadata = { title: '搜索历史' };
export const dynamic = 'force-dynamic';

export default function HistoryPage() {
  return <HistoryList />;
}

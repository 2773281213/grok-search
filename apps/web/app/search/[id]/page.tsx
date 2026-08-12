import type { Metadata } from 'next';
import { ResultWorkspace } from '@/components/result-workspace';

export const metadata: Metadata = { title: '搜索结果' };
export const dynamic = 'force-dynamic';

export default async function SearchResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResultWorkspace sessionId={id} />;
}

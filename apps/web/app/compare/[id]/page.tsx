import type { Metadata } from 'next';
import { ResultWorkspace } from '@/components/result-workspace';

export const metadata: Metadata = { title: '多模型对比' };
export const dynamic = 'force-dynamic';

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResultWorkspace sessionId={id} compare />;
}

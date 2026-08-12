import type { Metadata } from 'next';
import { HomeSearch } from '@/components/home-search';

export const metadata: Metadata = { title: '搜索' };
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return <HomeSearch />;
}

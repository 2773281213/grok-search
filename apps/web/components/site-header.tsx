import Link from 'next/link';
import { Clock3, Settings2 } from 'lucide-react';
import { Brand } from './brand';
import { ThemeToggle } from './theme-toggle';

export function SiteHeader() {
  return (
    <header className="site-header">
      <Brand />
      <nav aria-label="主导航">
        <Link href="/history"><Clock3 size={16} />历史</Link>
        <Link href="/settings"><Settings2 size={16} />设置</Link>
        <ThemeToggle />
      </nav>
    </header>
  );
}

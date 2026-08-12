import type { Metadata } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: {
    default: 'Cairn — 证据优先的 AI 搜索',
    template: '%s · Cairn',
  },
  description: '多模型、可引用、可恢复的开源 AI 搜索引擎。',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://question.11451405.xyz'),
  openGraph: {
    title: 'Cairn — 证据优先的 AI 搜索',
    description: '从问题到来源，从来源到证据。',
    type: 'website',
  },
};

const themeScript = `
(function(){try{var t=localStorage.getItem('cairn-theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div className="noise" aria-hidden="true" />
        <SiteHeader />
        {children}
        <footer className="site-footer">
          <span>Cairn · 开源证据搜索</span>
          <span>不展示隐藏思维链，只展示可验证过程。</span>
        </footer>
      </body>
    </html>
  );
}

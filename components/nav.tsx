'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: '首页', glyph: '○', hint: '今日训练概览' },
  { href: '/train', label: '训练', glyph: '▷', hint: '开始今天的题目' },
  { href: '/journal', label: '日志', glyph: '≡', hint: '真实生活思考日志' },
  { href: '/review', label: '复习', glyph: '↻', hint: '到期复习与错题' },
  { href: '/me', label: '我的', glyph: '◇', hint: '统计、设置与数据' },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[520px] border-t border-line bg-surface/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex items-stretch justify-between px-2 py-1">
        {TABS.map((tab) => {
          const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                title={tab.hint}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-lg text-[0.8125rem] no-underline transition-colors ${
                  active ? 'font-semibold text-ink' : 'text-muted'
                }`}
              >
                <span aria-hidden className="text-base leading-none">
                  {tab.glyph}
                </span>
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

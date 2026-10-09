import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';

import { AppProviders } from '@/app/providers';
import { BottomNav } from '@/components/nav';
import { ReminderGate } from '@/components/reminder-gate';
import { ServiceWorkerRegistration } from '@/components/service-worker-registration';

const THEME_BOOTSTRAP = `(function(){try{var k='logicdaily:theme';var m=localStorage.getItem(k);var t=(m==='light'||m==='dark')?m:'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`;

export const metadata: Metadata = {
  title: {
    default: 'LogicDaily · 每日逻辑思维训练',
    template: '%s · LogicDaily',
  },
  description:
    '每天 5～15 分钟的中文逻辑思维训练：逻辑推理、论证分析、因果辨析与真实生活思考日志，配合间隔复习与可选的 AI 思维教练。',
  applicationName: 'LogicDaily',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'LogicDaily',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  // 没有这一项，CSS 里的 env(safe-area-inset-*) 全部解析为 0，刘海与系统手势区会被内容压住。
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f4' },
    { media: '(prefers-color-scheme: dark)', color: '#14161a' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-theme="light">
      <head>
        {/* 首屏前确定主题，避免深色模式闪白；只读取本机 localStorage，不含任何个人数据 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <AppProviders>
          <a className="skip-link" href="#main">
            跳到主要内容
          </a>
          <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col">
            <main id="main" className="flex-1 px-4 pt-4 pb-28">
              {children}
            </main>
            {/* 动态路由的 pathname 只在运行时可得，用 Suspense 让静态外壳可以先输出 */}
            <Suspense fallback={<nav aria-hidden className="fixed inset-x-0 bottom-0 z-40 h-16 border-t border-line bg-surface" />}>
              <BottomNav />
            </Suspense>
            <ServiceWorkerRegistration />
            <ReminderGate />
          </div>
        </AppProviders>
      </body>
    </html>
  );
}

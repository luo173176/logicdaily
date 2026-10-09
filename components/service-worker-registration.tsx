'use client';

import { useEffect, useState } from 'react';

/**
 * Service Worker 注册与更新提示。
 * 更新策略：新 SW 安装后不自动接管（避免用户正在作答时页面被刷新），
 * 而是提示“有新版本”，由用户点击应用；关闭页面后自然生效。
 */
function canRegisterServiceWorker(): boolean {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  // 非安全上下文下浏览器不允许注册，本地开发除外。
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) return false;
  return true;
}

export function ServiceWorkerRegistration() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [supported] = useState(canRegisterServiceWorker);

  useEffect(() => {
    if (!supported) return;

    let cancelled = false;
    const registration = await_register();
    void registration.then((registrationValue) => {
      if (cancelled || !registrationValue) return;
      const update = () => {
        if (registrationValue.waiting) setWaiting(registrationValue.waiting);
      };
      update();
      registrationValue.addEventListener('updatefound', () => {
        const installing = registrationValue.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(registrationValue.waiting ?? installing);
          }
        });
      });
    });

    const interval = setInterval(
      () => {
        void navigator.serviceWorker.getRegistration().then((value) => value?.update());
      },
      60 * 60 * 1000,
    );

    return () => {
      cancelled = true;
      clearInterval(interval);
    };

    async function await_register() {
      try {
        return await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      } catch {
        return null;
      }
    }
  }, [supported]);

  if (!supported) return null;

  return (
    <>
      {waiting ? (
        <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4" role="status">
          <div className="card row gap-3 text-sm">
            <span>有新版本可用。</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                waiting.postMessage('skipWaiting');
                window.location.reload();
              }}
            >
              重新加载
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

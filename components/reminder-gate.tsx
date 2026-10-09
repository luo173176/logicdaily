'use client';

import { useEffect, useState } from 'react';

import { useApp } from '@/app/providers';
import { Button } from '@/components/ui';
import { decideReminder } from '@/lib/services/reminders';
import { listDueReviews } from '@/lib/services/training';

const firedKey = (dateKey: string) => `logicdaily:reminder-fired:${dateKey}`;

/**
 * 当日提醒的执行端。
 *
 * 决策逻辑（免打扰、休息日、每日一次、超时窗口）在 lib/services/reminders.ts 里，可单测。
 * 这里只负责「应用被打开时」检查一次并表达结果：PWA 无法保证后台唤醒，
 * 所以不存在“关掉页面后还会准时提醒”这回事，界面上也没有这样承诺。
 */
export function ReminderGate() {
  const { store, profileId, settings, dateKey, nowTs, ready, notify } = useApp();
  const [banner, setBanner] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    if (!ready || !store) return;
    if (!settings.reminders.enabled || settings.reminders.paused) return;
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(firedKey(dateKey))) return;

    let cancelled = false;
    (async () => {
      const plan = await store.getPlan(profileId, dateKey);
      if (!plan || cancelled) return;
      const progress = await store.getProgress(profileId, dateKey);
      const completed = new Set(progress?.completedItemIds ?? []);
      const pendingRequired = plan.items.filter((item) => item.required && !completed.has(item.id)).length;
      const due = await listDueReviews(store, profileId, dateKey, Date.now());
      if (cancelled) return;

      const stamp = new Date(nowTs || Date.now());
      const decision = decideReminder({
        settings,
        nowMinutes: stamp.getHours() * 60 + stamp.getMinutes(),
        weekday: stamp.getDay(),
        dateKey,
        lastNotifiedDateKey: null,
        pendingRequiredItems: pendingRequired,
        overdueDays: due[0]?.overdueDays ?? 0,
      });

      if (decision.action === 'none') return;
      // 每天最多表达一次，即使用户没关掉横幅。
      window.localStorage.setItem(firedKey(dateKey), '1');
      setBanner({ title: decision.title, body: decision.body });
      notify(decision.body);
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(decision.title, { body: decision.body, tag: 'logicdaily-daily' });
        } catch {
          // 部分浏览器要求先有用户手势，弹不出来时保留页内横幅即可。
        }
      }
    })().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [ready, store, profileId, settings, dateKey, nowTs, notify]);

  if (!banner) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 px-4" role="status">
      <div className="card stack gap-2">
        <p className="font-semibold text-sm">{banner.title}</p>
        <p className="text-sm muted">{banner.body}</p>
        <div className="row gap-2">
          <Button variant="secondary" size="sm" onClick={() => setBanner(null)}>
            知道了
          </Button>
        </div>
      </div>
    </div>
  );
}

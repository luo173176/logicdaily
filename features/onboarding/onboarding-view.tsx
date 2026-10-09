'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { useApp } from '@/app/providers';
import { Button, Field, Note, Skeleton } from '@/components/ui';
import { defaultSettings, settingsSchema, settingsSummary, type AppSettings } from '@/lib/domain/settings';
import { EXERCISE_CATEGORIES, CATEGORY_LABELS } from '@/lib/domain/taxonomy';
import { weekdayLabel } from '@/lib/domain/time';
import { isInQuietHours, minutesOfDay } from '@/lib/services/reminders';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function OnboardingView() {
  const { store, settings, saveSettings, notify, ready } = useApp();
  const router = useRouter();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    if (store && ready) setDraft(settings);
  }, [settings, store, ready]);

  if (!ready) return <Skeleton lines={4} />;

  const steps = [
    {
      title: '每天能投入多少时间？',
      hint: '5 分钟也能完成一次有效训练。宁可设小一点，稳定的练习比一次做很多更有价值。',
    },
    { title: '先从哪些方向开始？', hint: '可留空。留空时系统按你的作答表现自动选择练习面。' },
    { title: '数据保存在哪里？', hint: '默认全部保存在本机浏览器（IndexedDB），不经过任何服务器。' },
  ];

  const finish = async (onboarded: boolean) => {
    const next = settingsSchema.parse({ ...draft, onboarded: onboarded || skipped ? true : draft.onboarded });
    await saveSettings({ ...next, onboarded: true });
    notify(onboarded ? '设置已保存，开始第一道题。' : '已跳过引导。');
    router.push('/train');
  };

  return (
    <div className="stack gap-4">
      <header className="stack gap-1">
        <p className="label">
          第 {step + 1} / {steps.length} 步
        </p>
        <h1 className="text-2xl">{steps[step].title}</h1>
        <p className="muted text-sm">{steps[step].hint}</p>
      </header>

      {step === 0 ? (
        <div className="card stack gap-3">
          <Field label={`每日训练时长：${draft.dailyBudgetMinutes} 分钟`}>
            <input
              type="range"
              min={3}
              max={30}
              value={draft.dailyBudgetMinutes}
              onChange={(event) => setDraft({ ...draft, dailyBudgetMinutes: Number(event.target.value) })}
            />
          </Field>
          <Field label="新题与复习的比例" hint="刚开始建议保留一半时间给新题；复习队列变多时会自动提高复习占比。">
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(draft.newToReviewRatio * 100)}
              onChange={(event) => setDraft({ ...draft, newToReviewRatio: Number(event.target.value) / 100 })}
            />
          </Field>
          <Field label="休息日" hint="休息日只会减轻任务，不会中断连续训练天数。">
            <div className="row wrap gap-2">
              {WEEKDAYS.map((day) => {
                const pressed = draft.restWeekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={pressed}
                    className={`chip chip-toggle ${pressed ? 'border-brand' : ''}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        restWeekdays: pressed ? draft.restWeekdays.filter((d) => d !== day) : [...draft.restWeekdays, day],
                      })
                    }
                  >
                    {weekdayLabel(`2026-03-${String(9 + day).padStart(2, '0')}`)}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="card stack gap-2">
          <p className="label">选择感兴趣的训练方向</p>
          <div className="row wrap gap-2">
            {EXERCISE_CATEGORIES.map((category) => {
              const pressed = draft.preferredCategories.includes(category);
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={pressed}
                  className={`chip chip-toggle ${pressed ? 'border-brand' : ''}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      preferredCategories: pressed
                        ? draft.preferredCategories.filter((c) => c !== category)
                        : [...draft.preferredCategories, category],
                    })
                  }
                >
                  {CATEGORY_LABELS[category]}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="stack gap-3">
          <Note title="本地模式（当前）">
            <p>题目、作答、复习队列和思考日志都保存在这台设备的浏览器里。导出备份可以得到一个 JSON 文件。</p>
          </Note>
          <Note tone="neutral" title="AI 教练是可选的">
            <p>不配置任何模型时，逻辑题、判分、解析、错因归类、间隔复习与思考日志都能完整使用。需要时可以在“我的 → AI 教练”里配置服务端凭据。</p>
          </Note>
          <p className="faint">当前设置：{settingsSummary(draft)}</p>
        </div>
      ) : null}

      <div className="row-between">
        <Button
          variant="ghost"
          onClick={() => {
            if (step === 0) {
              setSkipped(true);
              void finish(true);
            } else {
              setStep(step - 1);
            }
          }}
        >
          {step === 0 ? '跳过引导' : '上一步'}
        </Button>
        <Button
          onClick={() => {
            if (step < steps.length - 1) setStep(step + 1);
            else void finish(true);
          }}
        >
          {step < steps.length - 1 ? '下一步' : '开始第一道题'}
        </Button>
      </div>
      {step === steps.length - 1 ? (
        <Link href="/train" className="text-sm text-brand">
          先跳过，直接开始 →
        </Link>
      ) : null}
    </div>
  );
}

export function quietHoursHint(settings: AppSettings): string {
  const target = minutesOfDay(settings.reminders.time);
  return isInQuietHours(target, { ...settings.reminders, enabled: true, paused: false }) ? '设定时间落在免打扰时段内，提醒不会发出。' : '';
}

export function restoreDefaults(): AppSettings {
  return defaultSettings('local');
}

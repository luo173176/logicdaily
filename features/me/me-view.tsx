'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { useApp } from '@/app/providers';
import { Button, Chip, Field, Note, SectionTitle, Skeleton, StatusBadge } from '@/components/ui';
import { settingsSchema, settingsSummary, type AppSettings } from '@/lib/domain/settings';
import { CATEGORY_LABELS, EXERCISE_CATEGORIES, KNOWLEDGE_POINT_LABELS } from '@/lib/domain/taxonomy';
import { masteryBand, masteryPercent } from '@/lib/domain/mastery';
import { EXERCISE_CONTENT_TAG } from '@/lib/content/packs';
import { weekdayLabel } from '@/lib/domain/time';
import type { ExerciseIssueReport } from '@/lib/domain/records';
import { applyTheme } from '@/lib/ai/client';
import { clearAllAiKeys } from '@/lib/ai/credentials';
import { AiSettingsSection } from '@/features/me/ai-settings';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function MeView() {
  const { store, profileId, settings, saveSettings, ready, seeding, reseedContent, notify, timezone } = useApp();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [dirty, setDirty] = useState(false);
  const [notificationState, setNotificationState] = useState<string>('未检测');
  const [issues, setIssues] = useState<ExerciseIssueReport[]>([]);
  const [syncInfo, setSyncInfo] = useState<{ localRevision: number; mode: string; pendingOps: number } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(settings), [settings]);

  const refresh = useCallback(async () => {
    if (!store) return;
    setIssues(await store.listIssues('open'));
    const state = await store.getSyncState(profileId);
    setSyncInfo(state ? { localRevision: state.localRevision, mode: state.mode, pendingOps: state.pendingOps } : null);
  }, [store, profileId]);

  useEffect(() => {
    if (!ready) return;
    void refresh();
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationState(Notification.permission);
    } else {
      setNotificationState('当前浏览器不支持通知');
    }
  }, [ready, refresh]);

  if (!ready) return <Skeleton lines={6} />;

  const patch = (changes: Partial<AppSettings>) => {
    setDraft((prev) => ({ ...prev, ...changes }));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const validated = settingsSchema.parse(draft);
      await saveSettings(validated);
      applyTheme(validated.theme);
      setDirty(false);
      notify('设置已保存。');
    } catch (error) {
      notify(error instanceof Error ? `设置有问题：${error.message.slice(0, 80)}` : '设置保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack gap-4">
      <header className="stack gap-1">
        <h1 className="text-2xl">我的</h1>
        <p className="muted text-sm">{settingsSummary(settings)}</p>
      </header>

      <div className="card row-between">
        <div className="stack gap-1">
          <Link href="/stats" className="font-semibold text-ink no-underline">
            训练报告与成长分析
          </Link>
          <span className="faint">正确率、错因分布、复习效果、日志行为指标</span>
        </div>
        <Button href="/stats" variant="secondary" size="sm">
          查看
        </Button>
      </div>

      <SectionTitle>训练偏好</SectionTitle>
      <section className="card stack gap-3">
        <Field label={`每日时长 ${draft.dailyBudgetMinutes} 分钟`}>
          <input
            type="range"
            min={3}
            max={30}
            value={draft.dailyBudgetMinutes}
            onChange={(event) => patch({ dailyBudgetMinutes: Number(event.target.value) })}
          />
        </Field>
        <Field label={`新题占比 ${Math.round(draft.newToReviewRatio * 100)}%`} hint="剩余时间留给到期复习；队列空出时会补新题。">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(draft.newToReviewRatio * 100)}
            onChange={(event) => patch({ newToReviewRatio: Number(event.target.value) / 100 })}
          />
        </Field>
        <Field label="难度倾向" hint="0 偏简单，1 偏难。系统仍会按你最近的表现微调目标难度。">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(draft.difficultyBias * 100)}
            onChange={(event) => patch({ difficultyBias: Number(event.target.value) / 100 })}
          />
        </Field>
        <Field label="训练方向">
          <div className="row wrap gap-2">
            {EXERCISE_CATEGORIES.map((category) => {
              const pressed = draft.preferredCategories.includes(category);
              return (
                <Chip
                  key={category}
                  pressed={pressed}
                  onPress={() =>
                    patch({
                      preferredCategories: pressed
                        ? draft.preferredCategories.filter((c) => c !== category)
                        : [...draft.preferredCategories, category],
                    })
                  }
                >
                  {CATEGORY_LABELS[category]}
                </Chip>
              );
            })}
          </div>
        </Field>
        <Field label="休息日">
          <div className="row wrap gap-2">
            {WEEKDAYS.map((day) => {
              const pressed = draft.restWeekdays.includes(day);
              return (
                <Chip
                  key={day}
                  pressed={pressed}
                  onPress={() => patch({ restWeekdays: pressed ? draft.restWeekdays.filter((d) => d !== day) : [...draft.restWeekdays, day] })}
                >
                  {weekdayLabel(`2026-03-${String(9 + day).padStart(2, '0')}`)}
                </Chip>
              );
            })}
          </div>
        </Field>
        <Field label="时区" hint="用于“今天”的判定与提醒时间，默认取设备时区。">
          <input type="text" value={draft.timezone} onChange={(event) => patch({ timezone: event.target.value })} />
        </Field>
      </section>

      <SectionTitle>提醒</SectionTitle>
      <section className="card stack gap-3">
        <div className="row-between">
          <span className="font-semibold">本地提醒</span>
          <Chip pressed={draft.reminders.enabled} onPress={() => patch({ reminders: { ...draft.reminders, enabled: !draft.reminders.enabled } })}>
            {draft.reminders.enabled ? '已开启' : '已关闭'}
          </Chip>
        </div>
        <div className="row-between">
          <span className="text-sm">暂时暂停</span>
          <Chip pressed={draft.reminders.paused} onPress={() => patch({ reminders: { ...draft.reminders, paused: !draft.reminders.paused } })}>
            {draft.reminders.paused ? '暂停中' : '未暂停'}
          </Chip>
        </div>
        <Field label="提醒时间">
          <input
            type="time"
            value={draft.reminders.time}
            onChange={(event) => patch({ reminders: { ...draft.reminders, time: event.target.value } })}
          />
        </Field>
        <div className="row gap-2">
          <Field label="免打扰开始">
            <input
              type="time"
              value={draft.reminders.quietStart}
              onChange={(event) => patch({ reminders: { ...draft.reminders, quietStart: event.target.value } })}
            />
          </Field>
          <Field label="免打扰结束">
            <input
              type="time"
              value={draft.reminders.quietEnd}
              onChange={(event) => patch({ reminders: { ...draft.reminders, quietEnd: event.target.value } })}
            />
          </Field>
        </div>
        <Field label="每周复盘提醒（星期几）">
          <div className="row wrap gap-2">
            {WEEKDAYS.map((day) => (
              <Chip
                key={day}
                pressed={draft.reminders.weeklyReviewDay === day}
                onPress={() => patch({ reminders: { ...draft.reminders, weeklyReviewDay: day } })}
              >
                {weekdayLabel(`2026-03-${String(9 + day).padStart(2, '0')}`)}
              </Chip>
            ))}
          </div>
        </Field>
        <div className="stack gap-2">
          <p className="label">通知权限：{notificationState}</p>
          {typeof window !== 'undefined' && 'Notification' in window && Notification.permission !== 'granted' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const result = await Notification.requestPermission();
                setNotificationState(result);
                notify(result === 'granted' ? '已允许通知。' : '通知权限未授予，应用内提示仍然可用。');
              }}
            >
              请求通知权限
            </Button>
          ) : null}
          <p className="faint">
            作为网页应用，只有页面开着（或 Service Worker 被系统唤醒）时才可能发出提醒，浏览器与系统的电池优化都会限制后台任务。
            需要可靠到点的提醒，请参考 docs/ANDROID.md 里的 Capacitor 方案。
          </p>
        </div>
      </section>

      <SectionTitle>外观</SectionTitle>
      <section className="card row wrap gap-2">
        {(['system', 'light', 'dark'] as const).map((theme) => (
          <Chip
            key={theme}
            pressed={draft.theme === theme}
            onPress={() => {
              patch({ theme });
              applyTheme(theme);
            }}
          >
            {theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'}
          </Chip>
        ))}
      </section>

      <AiSettingsSection draft={draft} patch={patch} profileId={profileId} ready={ready} />

      <SectionTitle>数据与隐私</SectionTitle>
      <section className="card stack gap-3">
        <div className="stack gap-2">
          <p className="label">本地数据状态</p>
          <ul className="stack gap-1 text-sm muted">
            <li>存储位置：本机浏览器 IndexedDB（logicdaily 数据库）</li>
            <li>数据所有权：你；导出文件是明文 JSON，可自行保管</li>
            <li>
              同步：{syncInfo ? `${syncInfo.mode} 模式，本地修订号 ${syncInfo.localRevision}` : '尚未初始化'}
              （云端同步尚未启用，见“已知限制”）
            </li>
            <li>题库内容版本：{EXERCISE_CONTENT_TAG}</li>
            <li>设备时区：{timezone}</li>
          </ul>
        </div>

        <div className="row wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              if (!store) return;
              const payload = await store.exportBackup(profileId);
              const text = JSON.stringify(payload, null, 2);
              const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = `logicdaily-backup-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
              notify(`已导出 ${payload.counts.attempts} 条作答、${payload.counts.journals} 篇日志。`);
            }}
          >
            导出备份
          </Button>
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            导入备份
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file || !store) return;
              setBusy(true);
              try {
                const text = await file.text();
                const result = await store.importBackup(JSON.parse(text));
                notify(`导入完成：新增 ${result.added}，覆盖 ${result.merged}，跳过 ${result.skipped}。`);
                await refresh();
              } catch (error) {
                notify(error instanceof Error ? `导入被拒绝：${error.message}` : '导入失败');
              } finally {
                setBusy(false);
                event.target.value = '';
              }
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => void reseedContent()}>
            重新载入题库
          </Button>
        </div>

        {seeding.status === 'failed' ? (
          <Note tone="bad" title="题库载入失败">
            {seeding.message}
          </Note>
        ) : null}

        <details className="stack gap-1">
          <summary className="cursor-pointer text-sm font-semibold">隐私说明与 AI 数据使用说明</summary>
          <div className="stack gap-2 text-sm muted">
            <p>· 默认不上传任何内容：题目、作答、推理文字与思考日志都留在本机。</p>
            <p>· 只有你主动点击“请 AI 分析”，且该篇日志勾选了允许发送时，日志正文才会经由服务端转发给模型服务商。</p>
            <p>· 分析请求只包含完成该任务所需的最少字段；服务端不记录 API Key、认证头和日志正文到应用日志。</p>
            <p>· 备份文件是明文 JSON，请自行妥善保管；导入前会校验结构与版本，异常文件会被拒绝。</p>
            <p>· 删除：单篇日志可在编辑页删除；“清除本地数据”会移除本机全部训练数据，不可撤销。</p>
          </div>
        </details>

        <Button
          variant="ghost"
          onClick={async () => {
            if (!store) return;
            const confirmed = window.confirm(
              '将删除本机保存的设置、作答记录、复习队列、日志与分析结果，以及直连模式保存在本机的 API Key。已导出的备份文件不受影响。确定继续？',
            );
            if (!confirmed) return;
            await store.clearLocalData(profileId);
            // API Key 存在 localStorage（不在 Dexie 里），必须一并清掉，
            // 否则「清除本地数据」会留下一把还能花钱的密钥。
            clearAllAiKeys();
            notify('本地数据已清除，页面即将刷新。');
            setTimeout(() => window.location.reload(), 800);
          }}
        >
          清除本地数据
        </Button>
      </section>

      <SectionTitle>题库复核清单</SectionTitle>
      <section className="card stack gap-2">
        {issues.length === 0 ? (
          <p className="faint">还没有被标记为有歧义的题目。做题时选择“题目本身有歧义”会进入这里。</p>
        ) : (
          <ul className="stack gap-1 text-sm">
            {issues.map((issue) => (
              <li key={issue.id} className="row-between">
                <span className="muted">
                  {issue.exerciseId} · {issue.note}
                </span>
                <span className="faint">{issue.dateKey}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SectionTitle>薄弱项速览</SectionTitle>
      <WeakPoints />

      <SectionTitle>关于</SectionTitle>
      <section className="card stack gap-1 text-sm">
        <p>LogicDaily · 每日逻辑思维训练 · 版本 0.1.0</p>
        <p className="muted">开源许可：AGPL-3.0-or-later。题库内容为项目原创撰写，欢迎在注明出处的前提下复用。</p>
        <p className="faint">已知限制：云端账户与跨设备同步尚未实现；PWA 后台提醒不可靠；APK 需要本地 Android 环境自行构建。详见 README 与 docs/。</p>
      </section>

      {dirty ? (
        <div className="sticky bottom-20 z-30">
          <div className="card row-between">
            <span className="text-sm">有未保存的设置</span>
            <div className="row gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(settings);
                  setDirty(false);
                }}
              >
                放弃
              </Button>
              <Button size="sm" disabled={busy} onClick={save}>
                {busy ? '保存中…' : '保存设置'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WeakPoints() {
  const { store, profileId, ready } = useApp();
  const [rows, setRows] = useState<{ id: string; percent: number | null; label: string }[]>([]);

  useEffect(() => {
    if (!store || !ready) return;
    void store.listKnowledgeStates(profileId).then((states) => {
      const sorted = [...states].sort((a, b) => a.ewma - b.ewma).slice(0, 5);
      setRows(
        sorted.map((state) => ({
          id: state.knowledgePointId,
          percent: masteryPercent(state),
          label: masteryBand(state).label,
        })),
      );
    });
  }, [store, profileId, ready]);

  if (rows.length === 0) return <p className="faint">还没有足够的知识点作答样本。</p>;
  return (
    <section className="card row wrap gap-2">
      {rows.map((row) => (
        <span key={row.id} className="chip">
          {KNOWLEDGE_POINT_LABELS[row.id] ?? row.id} · {row.percent ?? '样本不足'} · {row.label}
        </span>
      ))}
      <StatusBadge tone="neutral">仅供参考</StatusBadge>
    </section>
  );
}

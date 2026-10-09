'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { useApp } from '@/app/providers';
import { CoachPanel } from '@/features/coach/coach-panel';
import { Button, Chip, EmptyState, Field, Note, SectionTitle, Skeleton, StatusBadge } from '@/components/ui';
import {
  EVIDENCE_STANCE_LABELS,
  JOURNAL_STATUS_LABELS,
  createEmptyJournal,
  journalCompleteness,
  journalSchema,
  searchJournals,
  type Journal,
  type JournalEvidence,
} from '@/lib/domain/journal';
import { JOURNAL_STEPS } from '@/lib/domain/taxonomy';
import { addDays, formatDateTime } from '@/lib/domain/time';

const STATUS_TONE: Record<Journal['status'], 'ok' | 'warn' | 'neutral'> = {
  open: 'neutral',
  'review-due': 'warn',
  reviewed: 'ok',
  decided: 'ok',
  archived: 'neutral',
};

export function JournalListView() {
  const { store, profileId, dateKey, ready, timezone } = useApp();
  const [journals, setJournals] = useState<Journal[] | null>(null);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!store) return;
    try {
      const rows = await store.listJournals({ profileId });
      setJournals(rows.map((row) => markDue(row, dateKey)));
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取日志失败');
    }
  }, [store, profileId, dateKey]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const journal of journals ?? []) for (const t of journal.tags) set.add(t);
    return [...set].slice(0, 12);
  }, [journals]);

  const filtered = useMemo(() => (journals ?? []).filter((j) => searchJournals([j], query, tag).length > 0), [journals, query, tag]);

  if (!ready || journals === null) return <Skeleton lines={5} />;
  if (error)
    return (
      <Note tone="bad" title="读取失败">
        {error}
      </Note>
    );

  return (
    <div className="stack gap-4">
      <header className="stack gap-1">
        <h1 className="text-2xl">思考日志</h1>
        <p className="muted text-sm">记录真实生活里没想清楚的问题。这里的内容默认只保存在你的设备上，不会自动发送给任何模型。</p>
      </header>

      <div className="row gap-2">
        <input
          type="search"
          aria-label="搜索日志"
          placeholder="搜索标题、正文或标签"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="flex-1"
        />
        <Button href="/journal/new" size="sm">
          新建
        </Button>
        <Button href="/coach" variant="secondary" size="sm">
          分析材料
        </Button>
      </div>

      {tags.length > 0 ? (
        <div className="row wrap gap-2">
          {tags.map((item) => (
            <Chip key={item} pressed={tag === item} onPress={() => setTag(tag === item ? undefined : item)}>
              #{item}
            </Chip>
          ))}
        </div>
      ) : null}

      <SectionTitle>共 {filtered.length} 篇</SectionTitle>
      {filtered.length === 0 ? (
        <EmptyState
          title={journals.length === 0 ? '还没有思考日志' : '没有匹配的日志'}
          action={
            <Button href="/journal/new" size="sm">
              写第一篇
            </Button>
          }
        >
          <p>可以从一个让你困惑的现象开始，例如“为什么涨价之后销量反而增加了”。</p>
        </EmptyState>
      ) : (
        <ul className="stack gap-2">
          {filtered.map((journal) => {
            const completeness = journalCompleteness(journal);
            return (
              <li key={journal.id}>
                <Link href={`/journal/${journal.id}`} className="card stack gap-2 no-underline" data-pressable>
                  <div className="row-between">
                    <span className="font-semibold text-ink">{journal.title}</span>
                    <StatusBadge tone={STATUS_TONE[journal.status]}>{JOURNAL_STATUS_LABELS[journal.status]}</StatusBadge>
                  </div>
                  {journal.problem ? <p className="text-sm muted">{truncate(journal.problem)}</p> : null}
                  <div className="row wrap gap-2">
                    <span className="chip">
                      要点 {completeness.filled}/{completeness.total}
                    </span>
                    <span className="chip">证据 {journal.evidence.length}</span>
                    {journal.reviewDueDateKey ? <span className="chip">复盘 {journal.reviewDueDateKey}</span> : null}
                    {journal.tags.map((t) => (
                      <span key={t} className="chip">
                        #{t}
                      </span>
                    ))}
                  </div>
                  <p className="faint">更新 {formatDateTime(journal.updatedAt, timezone)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function JournalEditorView({ journalId }: { journalId?: string }) {
  const { store, profileId, dateKey, ready, timezone, notify } = useApp();
  const router = useRouter();
  const [journal, setJournal] = useState<Journal | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);

  useEffect(() => {
    if (!store || !ready) return;
    (async () => {
      if (journalId) {
        const found = await store.getJournal(profileId, journalId);
        if (!found) {
          setError('这篇日志不存在，或属于另一个账户。');
          return;
        }
        setJournal(found);
      } else {
        setJournal(
          createEmptyJournal({
            id: `jr-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
            profileId,
            nowTs: Date.now(),
          }),
        );
      }
    })();
  }, [store, ready, journalId, profileId]);

  const patch = useCallback((changes: Partial<Journal>) => {
    setJournal((prev) => (prev ? { ...prev, ...changes, updatedAt: Date.now() } : prev));
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!store || !journal) return;
    setBusy(true);
    setError(null);
    try {
      const validated = journalSchema.parse({ ...journal, updatedAt: Date.now() });
      await store.upsertJournal(validated);
      setJournal(validated);
      setDirty(false);
      // 新建的日志保存后换成可分享地址，刷新不会再丢内容。
      if (!journalId) router.replace(`/journal/${validated.id}`);
      notify('已保存到本机。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }, [journal, journalId, notify, router, store]);

  if (!ready) return <Skeleton lines={5} />;
  if (error && !journal)
    return (
      <Note tone="bad" title="无法打开日志">
        {error}
      </Note>
    );
  if (!journal) return <Skeleton lines={6} />;

  const completeness = journalCompleteness(journal);

  return (
    <div className="stack gap-4">
      <header className="stack gap-2">
        <Link href="/journal" className="text-sm text-brand no-underline">
          ← 返回日志列表
        </Link>
        <input
          aria-label="标题"
          value={journal.title}
          maxLength={120}
          onChange={(event) => patch({ title: event.target.value })}
          className="text-lg font-semibold"
        />
        <div className="row wrap gap-2">
          <StatusBadge tone={STATUS_TONE[journal.status]}>{JOURNAL_STATUS_LABELS[journal.status]}</StatusBadge>
          <span className="chip">
            要点 {completeness.filled}/{completeness.total}
          </span>
          <span className="faint">更新 {formatDateTime(journal.updatedAt, timezone)}</span>
        </div>
      </header>

      <section className="card stack gap-3">
        <Field label="我要回答的问题" htmlFor="problem" hint="写成一句可以被验证或推翻的话。">
          <textarea id="problem" rows={3} value={journal.problem} onChange={(e) => patch({ problem: e.target.value })} />
        </Field>
        <Field label="发生背景" htmlFor="background">
          <textarea id="background" rows={2} value={journal.background} onChange={(e) => patch({ background: e.target.value })} />
        </Field>
      </section>

      <SectionTitle>八步思考向导</SectionTitle>
      <p className="faint">不必每步都写。空着的步骤就是还没想清楚的地方。</p>
      <div className="stack gap-2">
        {JOURNAL_STEPS.map((step) => {
          const answer = journal.steps.find((s) => s.stepId === step.id)?.text ?? '';
          const open = openStep === step.id;
          return (
            <section key={step.id} className="card stack gap-2">
              <button
                type="button"
                className="row-between w-full bg-transparent text-left"
                aria-expanded={open}
                onClick={() => setOpenStep(open ? null : step.id)}
              >
                <span className="font-semibold">
                  第 {step.index} 步 · {step.title}
                </span>
                <span aria-hidden className="faint">
                  {open ? '收起' : answer ? '已写' : '展开'}
                </span>
              </button>
              {open ? (
                <div className="stack gap-2">
                  <p className="text-sm muted">{step.hint}</p>
                  <p className="inset text-sm">{step.prompt}</p>
                  <textarea
                    aria-label={step.title}
                    rows={4}
                    value={answer}
                    onChange={(event) => {
                      const next = [...journal.steps];
                      const index = next.findIndex((s) => s.stepId === step.id);
                      const entry = { stepId: step.id, text: event.target.value, updatedAt: Date.now() };
                      if (index === -1) next.push(entry);
                      else next[index] = entry;
                      patch({ steps: next });
                    }}
                  />
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <SectionTitle>结构化要点</SectionTitle>
      <section className="card stack gap-3">
        <Field label="已知事实（可被第三方核对）">
          <textarea rows={2} value={journal.facts} onChange={(e) => patch({ facts: e.target.value })} />
        </Field>
        <Field label="我的假设">
          <textarea rows={2} value={journal.assumptions} onChange={(e) => patch({ assumptions: e.target.value })} />
        </Field>
        <Field label="当前结论">
          <textarea rows={2} value={journal.conclusion} onChange={(e) => patch({ conclusion: e.target.value })} />
        </Field>
        <Field label="其他可能的解释">
          <textarea rows={2} value={journal.alternativeExplanations} onChange={(e) => patch({ alternativeExplanations: e.target.value })} />
        </Field>
        <Field label="关键不确定因素">
          <textarea rows={2} value={journal.keyUncertainties} onChange={(e) => patch({ keyUncertainties: e.target.value })} />
        </Field>
        <Field label="可以采取的验证行动">
          <textarea rows={2} value={journal.verificationActions} onChange={(e) => patch({ verificationActions: e.target.value })} />
        </Field>
      </section>

      <SectionTitle
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              patch({
                evidence: [
                  ...journal.evidence,
                  {
                    id: `ev-${Date.now().toString(36)}-${journal.evidence.length}`,
                    journalId: journal.id,
                    stance: 'support',
                    text: '',
                    source: '',
                    reliability: 3,
                    createdAt: Date.now(),
                  },
                ],
              })
            }
          >
            添加证据
          </Button>
        }
      >
        证据清单
      </SectionTitle>
      <div className="stack gap-2">
        {journal.evidence.length === 0 ? <p className="faint">支持结论的证据容易找，反对的才是关键。</p> : null}
        {journal.evidence.map((item, index) => (
          <EvidenceRow
            key={item.id}
            item={item}
            onChange={(next) => {
              const list = [...journal.evidence];
              list[index] = next;
              patch({ evidence: list });
            }}
            onRemove={() => patch({ evidence: journal.evidence.filter((_, i) => i !== index) })}
          />
        ))}
      </div>

      <SectionTitle>状态与复盘</SectionTitle>
      <section className="card stack gap-3">
        <div className="row wrap gap-2">
          {(['open', 'review-due', 'reviewed', 'decided', 'archived'] as const).map((status) => (
            <Chip key={status} pressed={journal.status === status} onPress={() => patch({ status })}>
              {JOURNAL_STATUS_LABELS[status]}
            </Chip>
          ))}
        </div>
        <Field label="复盘提醒日期" hint="留空表示不提醒。到期那天它会出现在今日任务里。">
          <input type="date" value={journal.reviewDueDateKey ?? ''} onChange={(e) => patch({ reviewDueDateKey: e.target.value || null })} />
        </Field>
        <div className="row wrap gap-2">
          {[addDays(dateKey, 3), addDays(dateKey, 14), addDays(dateKey, 60)].map((suggest) => (
            <Chip key={suggest} onPress={() => patch({ reviewDueDateKey: suggest })}>
              {suggest}
            </Chip>
          ))}
        </div>
        <Field label="写下结论时的信心（1 完全没把握 ～ 5 非常确定）">
          <input
            type="number"
            min={1}
            max={5}
            value={journal.selfConfidence}
            onChange={(e) => patch({ selfConfidence: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })}
          />
        </Field>
        <Field label="复盘结果（事后实际发生了什么）">
          <textarea rows={3} value={journal.reviewOutcome} onChange={(e) => patch({ reviewOutcome: e.target.value })} />
        </Field>
        <div className="row wrap gap-2">
          {(['better', 'as-expected', 'worse', 'unknown'] as const).map((delta) => (
            <Chip key={delta} pressed={journal.reviewDelta === delta} onPress={() => patch({ reviewDelta: delta })}>
              {delta === 'better' ? '比预期好' : delta === 'as-expected' ? '与预期一致' : delta === 'worse' ? '比预期差' : '还没判断'}
            </Chip>
          ))}
        </div>
        <Field label="标签" hint="用逗号分隔，最多 12 个。">
          <input
            type="text"
            value={journal.tags.join(', ')}
            onChange={(e) =>
              patch({
                tags: e.target.value
                  .split(/[,，]/)
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .slice(0, 12),
              })
            }
          />
        </Field>
      </section>

      <CoachPanel context={{ kind: 'journal', journal }} />

      {error ? (
        <Note tone="bad" title="保存时出现问题">
          {error}
        </Note>
      ) : null}

      <div className="card stack gap-2">
        <div className="row wrap gap-2">
          <Button disabled={busy || !dirty} onClick={save}>
            {busy ? '保存中…' : dirty ? '保存' : '已保存'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const blob = new Blob([JSON.stringify(journal, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${journal.title.replace(/[\\/:*?\"<>|]/g, '_')}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            导出这一篇
          </Button>
          <label className="btn btn-secondary">
            <input type="checkbox" className="mr-2" checked={journal.aiConsent} onChange={(e) => patch({ aiConsent: e.target.checked })} />
            允许我把这篇发给 AI 教练分析
          </label>
        </div>
        <p className="faint">勾选后仍只有你主动点击“请 AI 分析”时才会发送正文；不勾选时任何模型调用都不会包含这篇日志。</p>
        <Button
          variant="ghost"
          onClick={async () => {
            if (!store) return;
            patch({ deleted: true, deletedAt: Date.now(), updatedAt: Date.now() });
            await store.upsertJournal({ ...journal, deleted: true, deletedAt: Date.now(), updatedAt: Date.now() });
            notify('已删除，可在“我的 → 数据与隐私”里彻底清除。');
          }}
        >
          删除这篇（保留在备份中直到彻底清除）
        </Button>
      </div>
    </div>
  );
}

function EvidenceRow({ item, onChange, onRemove }: { item: JournalEvidence; onChange: (next: JournalEvidence) => void; onRemove: () => void }) {
  return (
    <div className="inset stack gap-2">
      <div className="row wrap gap-2">
        {(['support', 'oppose', 'alternative', 'unknown'] as const).map((stance) => (
          <Chip key={stance} pressed={item.stance === stance} onPress={() => onChange({ ...item, stance })}>
            {EVIDENCE_STANCE_LABELS[stance]}
          </Chip>
        ))}
      </div>
      <textarea
        aria-label="证据内容"
        rows={2}
        value={item.text}
        placeholder="这条证据是什么？从哪里来？"
        onChange={(e) => onChange({ ...item, text: e.target.value })}
      />
      <div className="row-between wrap gap-2">
        <input
          aria-label="来源"
          type="text"
          value={item.source}
          placeholder="来源（可选）"
          onChange={(e) => onChange({ ...item, source: e.target.value })}
        />
        <label className="row gap-2 text-sm muted">
          可靠性
          <input
            aria-label="可靠性 1 到 5"
            type="number"
            min={1}
            max={5}
            className="w-20"
            value={item.reliability}
            onChange={(e) => onChange({ ...item, reliability: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })}
          />
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
          移除
        </button>
      </div>
    </div>
  );
}

function markDue(journal: Journal, dateKey: string): Journal {
  if (journal.status === 'open' && journal.reviewDueDateKey && journal.reviewDueDateKey <= dateKey) {
    return { ...journal, status: 'review-due' };
  }
  return journal;
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { useApp } from '@/app/providers';
import { Button, Note, StatusBadge } from '@/components/ui';
import {
  analyzeReasoning,
  describeAiError,
  readAiStatus,
  reviewJournal,
  type AiStatus,
  type CoachResponse,
} from '@/lib/ai/client';
import { CATEGORY_LABELS, KNOWLEDGE_POINT_LABELS } from '@/lib/domain/taxonomy';
import type { Exercise } from '@/lib/domain/exercise-schema';
import type { AnswerInput } from '@/lib/domain/grading';
import { describeAnswer, type GradeResult } from '@/lib/domain/grading';
import type { Journal } from '@/lib/domain/journal';
import { answerTextForExercise } from '@/features/coach/answer-text';
import { outcomeLabel } from '@/lib/services/training';

interface CoachResultShape {
  argumentStructure?: { text: string; role: string }[];
  strengths?: string[];
  issues?: { description: string; errorType?: string | null; reason: string }[];
  supportingEvidence?: string[];
  opposingEvidence?: string[];
  alternativeExplanations?: string[];
  nextVerification?: { action: string; distinguishes?: string | null }[];
  uncertainty?: string;
  recommendedKnowledgePoints?: string[];
  questions?: string[];
  missingPremise?: string | null;
  factsMixedWithInference?: string[];
  strongestCounterView?: string | null;
}

type CoachContext =
  | { kind: 'attempt'; exercise: Exercise; grade: GradeResult; answer: AnswerInput; reasoning: string; confidence: number }
  | { kind: 'journal'; journal: Journal };

export function CoachPanel({ context }: { context: CoachContext }) {
  const { store, profileId, settings, dateKey, timezone, nowTs, notify } = useApp();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'failed'>('idle');
  const [payload, setPayload] = useState<CoachResponse<CoachResultShape> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!settings.ai.enabled) return;
    let cancelled = false;
    void readAiStatus().then((value) => {
      if (!cancelled) setStatus(value);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.ai.enabled]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const run = useCallback(async () => {
    if (!settings.ai.enabled) return;
    // 服务端配额才是权威；这一层只是避免在本机已经用完当天额度时继续发无意义的请求。
    if (store && settings.ai.dailyCallLimit > 0) {
      const usedLocally = await store.countAIUsageToday(profileId, dateKey, timezone);
      if (usedLocally >= settings.ai.dailyCallLimit) {
        setState('failed');
        setPayload({
          ok: false,
          code: 'local_budget',
          message: `本机今天已调用 ${usedLocally} 次，达到你设定的 ${settings.ai.dailyCallLimit} 次上限。可以在「我的」里调整，或明天再来。`,
        });
        return;
      }
    }
    setState('loading');
    setPayload(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), settings.ai.timeoutMs + 2000);

    let response: CoachResponse<CoachResultShape>;
    if (context.kind === 'attempt') {
      const exercise = context.exercise;
      response = (await analyzeReasoning(
        settings,
        {
          exerciseId: exercise.id,
          categoryKey: exercise.category,
          stem: exercise.stem,
          userAnswerText: answerTextForExercise(exercise, context.answer),
          correctAnswerText: describeAnswer(exercise),
          reasoning: context.reasoning,
          confidence: context.confidence,
          detectedErrorTypes: context.grade.errorTypes,
          explanationSteps: context.grade.outcome === 'correct' ? [] : exercise.explanation.steps.slice(0, 3),
          history: [],
        },
        controller.signal,
      )) as CoachResponse<CoachResultShape>;
    } else {
      const journal = context.journal;
      if (!journal.aiConsent) {
        clearTimeout(timer);
        setState('failed');
        setPayload({ ok: false, code: 'consent_required', message: '这篇日志还没有勾选“允许发送”，请先在编辑页勾选。' });
        return;
      }
      response = (await reviewJournal(
        settings,
        {
          title: journal.title,
          problem: journal.problem,
          background: journal.background,
          facts: journal.facts,
          assumptions: journal.assumptions,
          conclusion: journal.conclusion,
          alternativeExplanations: journal.alternativeExplanations,
          keyUncertainties: journal.keyUncertainties,
          verificationActions: journal.verificationActions,
          selfConfidence: journal.selfConfidence,
          evidence: journal.evidence.map((e) => ({
            stance: e.stance,
            text: e.text,
            source: e.source,
            reliability: e.reliability,
          })),
          stepNotes: journal.steps.map((s) => ({ stepId: s.stepId, text: s.text })),
          consented: true,
        },
        controller.signal,
      )) as CoachResponse<CoachResultShape>;
    }
    clearTimeout(timer);

    setPayload(response);
    setState(response.ok ? 'done' : 'failed');

    if (store) {
      await store.saveAIUsage({
        id: `usage-${Date.now().toString(36)}-${context.kind}`,
        profileId,
        task: context.kind === 'attempt' ? 'analyze-reasoning' : 'review-journal',
        provider: settings.ai.provider,
        model: response.meta?.model ?? settings.ai.model,
        promptVersion: response.meta?.promptVersion ?? 'unknown',
        createdAt: nowTs || Date.now(),
        latencyMs: response.meta?.latencyMs ?? 0,
        inputChars: response.meta?.inputChars ?? 0,
        outputChars: response.meta?.outputChars ?? 0,
        promptTokens: response.meta?.promptTokens ?? null,
        completionTokens: response.meta?.completionTokens ?? null,
        status: response.ok ? 'ok' : 'error',
        errorCode: response.ok ? null : (response.code ?? 'unknown'),
        // 只保存可公开的错误类别描述，不保存正文。
        errorMessage: response.ok ? null : (response.message ?? null),
      });
    }
    if (response.ok && context.kind === "journal") {
      await store?.saveAIAnalysis({
        id: `ana-${Date.now().toString(36)}`,
        profileId,
        subjectKind: 'journal',
        subjectId: context.journal.id,
        task: 'review-journal',
        provider: settings.ai.provider,
        model: response.meta?.model ?? settings.ai.model,
        promptVersion: response.meta?.promptVersion ?? 'unknown',
        createdAt: Date.now(),
        result: response.result ?? {},
        uncertainty: response.result?.uncertainty ?? '',
        retainedInputSummary: null,
      });
      notify('AI 反馈已保存（仅结构化结果，未保存日志正文）。');
    }
  }, [context, dateKey, nowTs, notify, profileId, settings, store, timezone]);

  if (!settings.ai.enabled) {
    return (
      <Note tone="neutral" title="AI 教练未启用">
        <div className="stack gap-2">
          <p>判分、解析、错因归类与复习调度都由本地规则完成，不需要模型。想启用可以在“我的 → AI 教练”里打开。</p>
          <Link href="/me" className="text-sm text-brand no-underline">
            去设置 →
          </Link>
        </div>
      </Note>
    );
  }

  if (status && !status.configured) {
    return (
      <Note tone="warn" title="服务端还没有模型凭据">
        <div className="stack gap-2">
          <p>{status.message ?? '配置好 AI_API_KEY、AI_BASE_URL 与 AI_MODEL 后，这里才能给出反馈。其他功能不受影响。'}</p>
          <Link href="/me" className="text-sm text-brand no-underline">
            查看配置说明 →
          </Link>
        </div>
      </Note>
    );
  }

  return (
    <section className="card stack gap-3">
      <div className="row-between">
        <p className="font-semibold">AI 思维教练</p>
        <Button size="sm" variant="secondary" disabled={state === 'loading'} onClick={run}>
          {state === 'loading' ? '思考中…' : payload ? '再问一次' : context.kind === 'journal' ? '请教练复盘这篇日志' : '请教练看我的推理'}
        </Button>
      </div>

      {state === 'failed' && payload ? (
        <Note tone="bad" title="这次没有拿到反馈">
          <p>{payload.message ?? describeAiError(payload.code)}</p>
          {payload.code === 'rate_limited' && payload.retryAfterSeconds ? <p className="faint">建议 {payload.retryAfterSeconds} 秒后重试。</p> : null}
        </Note>
      ) : null}

      {state === 'done' && payload?.result ? (
        <div className="stack gap-3">
          {payload.result.questions?.length ? (
            <div className="stack gap-1">
              <p className="label">先想清楚这几个问题</p>
              <ol className="stack gap-1 pl-5 text-sm">
                {payload.result.questions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {payload.result.strengths?.length ? (
            <div className="stack gap-1">
              <p className="label">你做对的部分</p>
              <ul className="stack gap-0.5 text-sm">
                {payload.result.strengths.map((item, index) => (
                  <li key={index}>· {item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {payload.result.issues?.length ? (
            <div className="stack gap-1">
              <p className="label">可能的问题</p>
              <ul className="stack gap-1 text-sm">
                {payload.result.issues.map((issue, index) => (
                  <li key={index} className="inset">
                    <p>{issue.description}</p>
                    <p className="faint">
                      {issue.errorType ? `${issue.errorType} · ` : ''}
                      {issue.reason}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {payload.result.argumentStructure?.length ? (
            <details className="stack gap-1">
              <summary className="cursor-pointer text-sm text-brand">论证结构</summary>
              <ul className="stack gap-0.5 text-sm muted">
                {payload.result.argumentStructure.map((part, index) => (
                  <li key={index}>
                    [{part.role}] {part.text}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="grid grid-cols-2 gap-2 text-sm">
            <EvidenceColumn title="支持证据" items={payload.result.supportingEvidence ?? []} />
            <EvidenceColumn title="反对证据" items={payload.result.opposingEvidence ?? []} />
          </div>

          {payload.result.alternativeExplanations?.length ? (
            <div className="stack gap-1">
              <p className="label">其他可能的解释</p>
              <ul className="stack gap-0.5 text-sm">
                {payload.result.alternativeExplanations.map((item, index) => (
                  <li key={index}>· {item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {payload.result.nextVerification?.length ? (
            <div className="stack gap-1">
              <p className="label">下一步验证</p>
              <ul className="stack gap-1 text-sm">
                {payload.result.nextVerification.map((step, index) => (
                  <li key={index} className="inset">
                    {step.action}
                    {step.distinguishes ? <span className="block faint">能区分：{step.distinguishes}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {context.kind === 'journal' && payload.result.factsMixedWithInference?.length ? (
            <div className="stack gap-1">
              <p className="label">被当成事实的内容</p>
              <ul className="stack gap-0.5 text-sm">
                {payload.result.factsMixedWithInference.map((item, index) => (
                  <li key={index}>· {item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {payload.result.uncertainty ? (
            <Note tone="warn" title="这次反馈的可靠性">
              <p>{payload.result.uncertainty}</p>
              <p className="faint mt-1">
                模型输出不是事实判定。若与题目解析冲突，以解析与你自己的核对为准，并欢迎在“我的 → 题库复核清单”里反馈。
              </p>
            </Note>
          ) : null}

          {payload.result.recommendedKnowledgePoints?.length ? (
            <div className="row wrap gap-2">
              <span className="label">建议练习方向</span>
              {payload.result.recommendedKnowledgePoints.map((item) => (
                <span key={item} className="chip">
                  {KNOWLEDGE_POINT_LABELS[item] ?? item}
                </span>
              ))}
            </div>
          ) : null}

          {payload.meta ? (
            <p className="faint">
              {payload.meta.model} · 提示词 {payload.meta.promptVersion} · {payload.meta.latencyMs}ms · 输入 {payload.meta.inputChars} 字 ·
              今日已用 {payload.meta.usedToday}/{payload.meta.usedToday + payload.meta.remainingToday}
            </p>
          ) : null}
        </div>
      ) : null}

      {state === 'idle' ? (
        <p className="faint">
          教练默认采用苏格拉底式提问：先问你，而不是直接给答案。发送内容只包含
          {context.kind === 'attempt' ? `本题题干、你的答案与推理（题型：${CATEGORY_LABELS[context.exercise.category]}，${outcomeLabel(context.grade.outcome)}）` : '这篇日志的结构化字段与证据'}。
        </p>
      ) : null}
    </section>
  );
}

function EvidenceColumn({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="stack gap-1">
      <p className="label">{title}</p>
      {items.length === 0 ? (
        <p className="faint">（无）</p>
      ) : (
        <ul className="stack gap-0.5">
          {items.map((item, index) => (
            <li key={index}>· {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CoachUsageSummary() {
  const { store, profileId, dateKey, timezone, ready } = useApp();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!store || !ready) return;
    void store.countAIUsageToday(profileId, dateKey, timezone).then(setCount);
  }, [store, profileId, dateKey, timezone, ready]);

  if (count === null) return null;
  return (
    <StatusBadge tone="neutral" symbol="◇">
      今天已调用 {count} 次
    </StatusBadge>
  );
}

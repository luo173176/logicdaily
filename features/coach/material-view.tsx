'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { useApp } from '@/app/providers';
import { Button, Field, Note, SectionTitle } from '@/components/ui';
import { analyzeMaterial, describeAiError, directReadiness, readAiStatus, type AiStatus } from '@/lib/ai/client';

interface MaterialResult {
  mainConclusion?: string;
  premises?: string[];
  implicitAssumptions?: string[];
  fallacies?: { name: string; where: string; why: string }[];
  evidenceQuality?: string;
  missingInformation?: string[];
  alternativeExplanations?: string[];
  nextVerification?: { action: string; distinguishes?: string | null }[];
  uncertainty?: string;
  strengths?: string[];
  issues?: { description: string; reason: string; errorType?: string | null }[];
}

const EVIDENCE_LABELS: Record<string, string> = {
  strong: '较强：可核对且考虑了对照',
  mixed: '混合：部分可核对，部分只是陈述',
  weak: '较弱：以个案或断言为主',
  absent: '缺失：几乎没有给出证据',
};

const SAMPLES = [
  {
    label: '示例：健康类推文',
    text: '“我们村的人每天都喝这种自制凉茶，八十岁以上的人比城里多得多，说明这个凉茶能长寿。专家都不说，是因为他们不懂传统配方。你也赶紧试试，别等病了才后悔。”',
  },
  {
    label: '示例：产品宣传',
    text: '“上线新版首页后，转化率从 2.1% 提升到 2.8%，因此新首页的设计是这次增长的原因。竞品最近没有大动作，用户也更喜欢我们的风格了。”',
  },
];

export function MaterialCoachView() {
  const { store, profileId, settings, dateKey, timezone, nowTs } = useApp();
  const [text, setText] = useState('');
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'failed'>('idle');
  const [result, setResult] = useState<MaterialResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const direct = settings.ai.mode === 'direct';

  useEffect(() => {
    // 直连模式没有本站状态接口可查，查了只会得到一条误导性的「连不上」。
    if (direct) return;
    let cancelled = false;
    void readAiStatus().then((value) => {
      if (!cancelled) setStatus(value);
    });
    return () => {
      cancelled = true;
    };
  }, [direct]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async () => {
    if (text.trim().length < 20) {
      setError('请至少粘贴 20 个字，太短无法分析论证结构。');
      return;
    }
    // 代理模式下服务端还有权威配额，这里只避免明显无意义的请求；直连模式下这是唯一的额度约束。
    if (store && settings.ai.dailyCallLimit > 0) {
      const usedLocally = await store.countAIUsageToday(profileId, dateKey, timezone);
      if (usedLocally >= settings.ai.dailyCallLimit) {
        setError(`本机今天已调用 ${usedLocally} 次，达到你设定的 ${settings.ai.dailyCallLimit} 次上限。可以在「我的」里调整，或明天再来。`);
        return;
      }
    }
    setState('loading');
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const response = await analyzeMaterial(settings, text.trim(), question.trim() || undefined, controller.signal);
    if (response.ok && response.result) {
      setResult(response.result as MaterialResult);
      setState('done');
      if (store) {
        await store.saveAIUsage({
          id: `usage-${Date.now().toString(36)}-material`,
          profileId,
          task: 'analyze-material',
          provider: settings.ai.provider,
          model: response.meta?.model ?? settings.ai.model,
          promptVersion: response.meta?.promptVersion ?? 'unknown',
          createdAt: nowTs || Date.now(),
          latencyMs: response.meta?.latencyMs ?? 0,
          inputChars: response.meta?.inputChars ?? text.length,
          outputChars: response.meta?.outputChars ?? 0,
          promptTokens: response.meta?.promptTokens ?? null,
          completionTokens: response.meta?.completionTokens ?? null,
          status: 'ok',
          errorCode: null,
          errorMessage: null,
        });
        await store.saveAIAnalysis({
          id: `ana-${Date.now().toString(36)}`,
          profileId,
          subjectKind: 'material',
          subjectId: null,
          task: 'analyze-material',
          provider: settings.ai.provider,
          model: response.meta?.model ?? settings.ai.model,
          promptVersion: response.meta?.promptVersion ?? 'unknown',
          createdAt: Date.now(),
          result: response.result,
          uncertainty: (response.result as MaterialResult)?.uncertainty ?? '',
          // 默认不长期保存材料原文，只保留结构化结论。
          retainedInputSummary: null,
        });
      }
    } else {
      setState('failed');
      setError(response.message ?? describeAiError(response.code));
    }
  }, [dateKey, nowTs, profileId, question, settings, store, text, timezone]);

  const directState = direct ? directReadiness(settings) : null;
  const aiReady = directState ? directState.ready : Boolean(status?.configured);

  return (
    <div className="stack gap-4">
      <header className="stack gap-1">
        <Link href="/" className="text-sm text-brand no-underline">
          ← 返回首页
        </Link>
        <h1 className="text-2xl">材料论证分析</h1>
        <p className="muted text-sm">
          把新闻、公告、朋友圈或工作邮件里的段落贴进来，教练会拆出结论、前提、隐含假设与证据缺口。分析结果由模型生成，需要你自行核对。
        </p>
      </header>

      {!aiReady ? (
        <Note tone="warn" title={directState ? '直连还差一步' : '这个功能需要配置模型服务'}>
          <div className="stack gap-2">
            <p>
              {directState
                ? `${directState.missing}。这个构建里没有服务端，填齐之后请求从本机直接发给模型服务。`
                : (status?.message ?? '服务端还没有设置 AI_API_KEY、AI_BASE_URL 与 AI_MODEL。其余训练功能不依赖模型，可以照常使用。')}
            </p>
            <Link href="/me" className="text-sm text-brand no-underline">
              查看配置说明 →
            </Link>
          </div>
        </Note>
      ) : null}

      <section className="card stack gap-3">
        <Field label="待分析材料" hint={`已输入 ${text.trim().length} 字，上限 12000 字。`}>
          <textarea rows={8} value={text} maxLength={12_000} onChange={(event) => setText(event.target.value)} placeholder="粘贴一段论述…" />
        </Field>
        <Field label="你特别想弄清楚的问题（可选）">
          <input
            type="text"
            value={question}
            maxLength={200}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="例如：它有没有把相关当因果？"
          />
        </Field>
        <div className="row wrap gap-2">
          {SAMPLES.map((sample) => (
            <Button key={sample.label} size="sm" variant="secondary" onClick={() => setText(sample.text)}>
              {sample.label}
            </Button>
          ))}
        </div>
        <Button disabled={state === 'loading' || !aiReady} onClick={run}>
          {state === 'loading' ? '分析中…' : '开始分析'}
        </Button>
        <p className="faint">这段文字会被发送到模型服务处理。不要粘贴身份证号、住址、健康细节等敏感信息；服务端不会把材料原文写入日志。</p>
      </section>

      {state === 'failed' && error ? (
        <Note tone="bad" title="分析失败">
          {error}
        </Note>
      ) : null}

      {state === 'done' && result ? (
        <>
          <SectionTitle>结论与前提</SectionTitle>
          <section className="card stack gap-2">
            <p className="label">作者的主张</p>
            <p>{result.mainConclusion}</p>
            <p className="label mt-2">明确前提</p>
            <List items={result.premises ?? []} />
            <p className="label mt-2">隐含假设</p>
            <List items={result.implicitAssumptions ?? []} empty="没有识别出额外的隐含假设。" />
            <p className="label mt-2">证据质量</p>
            <p>{EVIDENCE_LABELS[result.evidenceQuality ?? ''] ?? result.evidenceQuality}</p>
          </section>

          {result.fallacies?.length ? (
            <>
              <SectionTitle>可能的推理缺陷</SectionTitle>
              <ul className="stack gap-2">
                {result.fallacies.map((item, index) => (
                  <li key={index} className="card stack gap-1">
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-sm muted">{item.where}</p>
                    <p className="faint">{item.why}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <SectionTitle>还需要哪些信息</SectionTitle>
          <section className="card stack gap-2">
            <List items={result.missingInformation ?? []} />
            <p className="label mt-2">可以做的验证</p>
            {(result.nextVerification ?? []).length === 0 ? (
              <p className="faint">没有给出可执行动作。</p>
            ) : (
              <ul className="stack gap-1 text-sm">
                {(result.nextVerification ?? []).map((step, index) => (
                  <li key={index} className="inset">
                    {step.action}
                    {step.distinguishes ? <span className="block faint">能区分：{step.distinguishes}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Note tone="neutral" title="这次分析的可靠性">
            <p>{result.uncertainty}</p>
            <p className="faint mt-1">模型可能出错，也可能漏掉材料之外的背景。把它的结论当作一份待核对的草稿，而不是判定。</p>
          </Note>
        </>
      ) : null}
    </div>
  );
}

function List({ items, empty = '没有列出内容。' }: { items: string[]; empty?: string }) {
  if (items.length === 0) return <p className="faint">{empty}</p>;
  return (
    <ul className="stack gap-0.5 text-sm">
      {items.map((item, index) => (
        <li key={index}>· {item}</li>
      ))}
    </ul>
  );
}

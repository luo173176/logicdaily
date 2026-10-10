'use client';

import { useEffect, useState } from 'react';

import { Button, Chip, Field, Note, SectionTitle } from '@/components/ui';
import { readAiStatus, testAiConnection, type AiStatus } from '@/lib/ai/client';
import { clearAiKey, maskAiKey, readAiKey, writeAiKey } from '@/lib/ai/credentials';
import { AI_PROVIDER_SHORTCUTS, type AppSettings } from '@/lib/domain/settings';

interface Props {
  draft: AppSettings;
  patch: (changes: Partial<AppSettings>) => void;
  profileId: string;
  ready: boolean;
}

/**
 * AI 教练设置。两种模式的区别必须在界面上说清楚，而不是让用户去猜：
 * 服务端代理把密钥留在服务器；本机直连把密钥放在这台设备的 localStorage 里。
 */
export function AiSettingsSection({ draft, patch, profileId, ready }: Props) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [probe, setProbe] = useState<string | null>(null);
  const [revealKey, setRevealKey] = useState(false);
  // 惰性读取：密钥只在本机，挂载时取一次即可，不需要先渲染空值再补一次 setState。
  const [apiKey, setApiKey] = useState(() => readAiKey(profileId));
  const direct = draft.ai.mode === 'direct';

  // 直连模式不查本站状态接口（那里根本没有服务端），查了反而会看到一条误导性的错误。
  useEffect(() => {
    if (!ready || direct) return;
    let cancelled = false;
    void readAiStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, direct]);

  const aiPatch = (changes: Partial<AppSettings['ai']>) => patch({ ai: { ...draft.ai, ...changes } });

  const commitKey = (value: string) => {
    setApiKey(value);
    writeAiKey(profileId, value);
  };

  return (
    <>
      <SectionTitle>AI 教练</SectionTitle>
      <section className="card stack gap-3">
        <div className="row-between">
          <span className="font-semibold">在本设备启用 AI 教练</span>
          <Chip pressed={draft.ai.enabled} onPress={() => aiPatch({ enabled: !draft.ai.enabled })}>
            {draft.ai.enabled ? '已启用' : '未启用'}
          </Chip>
        </div>

        <Field label="请求怎么走" hint="两种模式的密钥位置与配额来源不同，按你的部署情况选。">
          <div className="row wrap gap-2">
            <Chip pressed={!direct} onPress={() => aiPatch({ mode: 'server' })}>
              服务端代理
            </Chip>
            <Chip pressed={direct} onPress={() => aiPatch({ mode: 'direct' })}>
              本机直连
            </Chip>
          </div>
        </Field>

        {!direct ? (
          status === null ? (
            <p className="faint">正在检查服务端配置…</p>
          ) : status.unreachable ? (
            <Note tone="warn" title="这里连不上 AI 接口">
              <p>{status.message}</p>
              <p className="faint">如果你用的是 APK 或纯静态托管，这是预期的：改用上面的「本机直连」即可在没有服务器的情况下使用 AI。</p>
            </Note>
          ) : status.configured ? (
            <Note tone="ok" title="服务端凭据已就绪">
              <p>
                默认模型 {status.defaultModel}；允许的用户 Base URL 数量 {status.allowedBaseUrlCount}。密钥由服务端环境变量保存，
                不会下发到浏览器，也不会写入本机数据。
              </p>
            </Note>
          ) : (
            <Note tone="neutral" title="尚未配置模型服务">
              <p>请在服务器环境变量里设置 AI_API_KEY、AI_BASE_URL 与 AI_MODEL（见 .env.example 与 docs/AI_INTEGRATION.md）。</p>
              <p className="faint">不想部署服务器？切到「本机直连」。</p>
            </Note>
          )
        ) : (
          <Note tone="warn" title="直连模式：密钥存在这台设备上">
            <div className="stack gap-1">
              <p>请求从本机直接发给模型服务商，不经过任何服务器，所以 APK 和静态托管也能用。</p>
              <p>
                代价要说清楚：密钥以明文存在本设备的浏览器存储里，拿到这台设备就能看到；它<strong>不会</strong>写进导出的备份文件； 没有服务端配额与
                SSRF 允许列表，只有你设定的每日次数上限；服务商必须允许浏览器跨域访问 （实测 DeepSeek、Kimi、通义、StepFun、SiliconFlow
                可以，智谱的接口不允许）。
              </p>
            </div>
          </Note>
        )}

        {direct ? (
          <>
            <Field label="常用服务（点一下填入下面两项，之后可自由修改）">
              <div className="row wrap gap-2">
                {AI_PROVIDER_SHORTCUTS.map((preset) => (
                  <Chip
                    key={preset.id}
                    pressed={Boolean(preset.baseUrl) && draft.ai.baseUrl === preset.baseUrl}
                    onPress={() =>
                      aiPatch({
                        provider: preset.id,
                        ...(preset.baseUrl ? { baseUrl: preset.baseUrl } : {}),
                        ...(preset.model ? { model: preset.model } : {}),
                      })
                    }
                  >
                    {preset.label}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field
              label="模型服务地址（Base URL）"
              htmlFor="ai-base-url"
              hint="填到版本目录为止，例如 https://api.deepseek.com/v1。会自动补 /chat/completions。"
            >
              <input
                id="ai-base-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={draft.ai.baseUrl}
                onChange={(event) => {
                  const value = event.target.value;
                  // 地址一改，「提供商」这个标记就不再可信了：用量记录里的 provider 字段要跟得上，
                  // 否则会一直写着 deepseek，而实际打的是用户自己填的另一个地址。
                  const matched = AI_PROVIDER_SHORTCUTS.find((preset) => preset.baseUrl && preset.baseUrl === value.trim());
                  aiPatch({ baseUrl: value, provider: matched?.id ?? 'custom' });
                }}
                placeholder="https://api.example.com/v1"
              />
            </Field>
            <Field
              label="API Key"
              htmlFor="ai-api-key"
              hint={apiKey ? `已保存在本机：${maskAiKey(apiKey)}` : '只写入这台设备的浏览器存储，不进备份文件。'}
            >
              <div className="row gap-2">
                <input
                  id="ai-api-key"
                  type={revealKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(event) => commitKey(event.target.value)}
                  placeholder="sk-..."
                />
                <Button variant="ghost" size="sm" onClick={() => setRevealKey((prev) => !prev)}>
                  {revealKey ? '隐藏' : '显示'}
                </Button>
              </div>
              {apiKey ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    commitKey('');
                    clearAiKey(profileId);
                    setApiKey('');
                  }}
                >
                  清除本机密钥
                </Button>
              ) : null}
            </Field>
          </>
        ) : (
          <Field label="提供商" htmlFor="ai-provider" hint="仅作标记用；服务端代理模式真正连哪家由服务器的 AI_BASE_URL 决定。">
            <select
              id="ai-provider"
              value={draft.ai.provider}
              onChange={(event) => aiPatch({ provider: event.target.value as AppSettings['ai']['provider'] })}
            >
              {AI_PROVIDER_SHORTCUTS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.id}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="模型名称" htmlFor="ai-model" hint={direct ? '直连模式必须填写，没有服务端默认值可回退。' : '留空则使用服务端默认模型。'}>
          <input
            id="ai-model"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={draft.ai.model}
            onChange={(event) => aiPatch({ model: event.target.value })}
            placeholder={direct ? 'deepseek-chat' : ''}
          />
        </Field>
        <Field label="温度" htmlFor="ai-temperature" hint="思维分析建议 0.2～0.6，越高越发散但也更容易跑题。">
          <input
            id="ai-temperature"
            type="range"
            min={0}
            max={100}
            value={Math.round(draft.ai.temperature * 100)}
            onChange={(event) => aiPatch({ temperature: Number(event.target.value) / 100 })}
          />
        </Field>
        <div className="row gap-2">
          <Field label="超时（毫秒）" htmlFor="ai-timeout">
            <input
              id="ai-timeout"
              type="number"
              min={3000}
              max={120000}
              step={1000}
              value={draft.ai.timeoutMs}
              onChange={(event) => aiPatch({ timeoutMs: Number(event.target.value) })}
            />
          </Field>
          <Field label="输出长度上限" htmlFor="ai-max-output">
            <input
              id="ai-max-output"
              type="number"
              min={128}
              max={4000}
              step={64}
              value={draft.ai.maxOutputTokens}
              onChange={(event) => aiPatch({ maxOutputTokens: Number(event.target.value) })}
            />
          </Field>
        </div>
        <Field
          label="每日调用次数上限"
          htmlFor="ai-daily-limit"
          hint={
            direct
              ? '0 表示完全不调用模型。直连模式下这是唯一的额度约束（没有服务端配额兜底），由本机在教练页调用前统计并执行；「测试连接」不计数。'
              : '0 表示完全不调用模型。这是本机的自我约束；服务端另有权威配额（由部署者的 AI_DAILY_LIMIT 决定），以先到的一方为准。'
          }
        >
          <input
            id="ai-daily-limit"
            type="number"
            min={0}
            max={200}
            value={draft.ai.dailyCallLimit}
            onChange={(event) => aiPatch({ dailyCallLimit: Number(event.target.value) })}
          />
        </Field>
        <div className="row wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              setProbe('测试中…');
              const result = await testAiConnection(draft);
              setProbe(result.ok ? `连接正常：${result.reply ?? ''}` : `失败：${result.message}`);
            }}
          >
            测试连接
          </Button>
          {probe ? (
            <p className="faint" role="status">
              {probe}
            </p>
          ) : null}
        </div>
        <p className="faint">改动模型名/地址/额度后记得点下面的「保存设置」；API Key 是即时写入本机的，不需要保存。</p>
      </section>
    </>
  );
}

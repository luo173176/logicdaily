import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';

/**
 * 端到端验证「本机直连」这条通路：页面 → 用户填的 Base URL → 模型服务商。
 *
 * 用真正的本地 HTTP 服务而不是桩掉 fetch，是为了把这几件事真的跑一遍：
 * 跨域预检能否通过、Authorization 是否带上、请求只发给用户填的那个地址、
 * 回复经过同一套 zod 契约校验、密钥刷新后仍在且界面上看不到明文。
 *
 * Service Worker 只处理同源 GET，这里的跨域 POST 不受它影响，所以不需要注销。
 */

const TEST_KEY = 'sk-unit-test-key-1234567890';

interface Seen {
  authorization: string | null;
  model: string | null;
  path: string | null;
  body: string;
}

function startMockProvider(seen: Seen[], content: (body: string) => string): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
    };
    const server = createServer((request, response) => {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, cors);
        response.end();
        return;
      }
      let body = '';
      request.on('data', (chunk) => {
        body += String(chunk);
      });
      request.on('end', () => {
        let parsed: { model?: string } = {};
        try {
          parsed = JSON.parse(body) as { model?: string };
        } catch {
          /* 记录原始正文，断言失败时更容易看出问题 */
        }
        seen.push({ authorization: request.headers.authorization ?? null, model: parsed.model ?? null, path: request.url ?? null, body });
        response.writeHead(200, { 'content-type': 'application/json', ...cors });
        response.end(
          JSON.stringify({
            choices: [{ message: { content: content(body) } }],
            model: parsed.model ?? 'mock',
            usage: { prompt_tokens: 620, completion_tokens: 12, total_tokens: 632 },
          }),
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** 满足 materialAnalysisSchema 的最小合法回复，用来证明直连拿到的结果真的进了界面。 */
const MATERIAL_ANALYSIS = {
  mainConclusion: '新首页是这次增长的原因',
  premises: ['转化率从 2.1% 提升到 2.8%'],
  implicitAssumptions: ['同期没有别的变量在动'],
  fallacies: [{ name: '因果简化', where: '因此新首页的设计是这次增长的原因', why: '把时间上的先后当成了因果' }],
  evidenceQuality: 'weak',
  missingInformation: ['同期投放与价格是否变化'],
  alternativeExplanations: ['竞品减少活动带来的自然流量'],
  nextVerification: [{ action: '按渠道拆开看转化增量', distinguishes: '能区分设计带来的量与自然流量' }],
  uncertainty: '只有自述数字，统计口径无法核对',
  strengths: ['给出了具体数字'],
  issues: [{ description: '把相关当成因果', reason: '同一时间窗口里还有别的变量', errorType: 'correlation-as-causation' }],
  argumentStructure: [{ text: '转化率提升了', role: 'premise' }],
  supportingEvidence: [],
  opposingEvidence: [],
  recommendedKnowledgePoints: ['相关与因果'],
};

async function openDirectSettings(page: Page): Promise<void> {
  await page.goto('/me');
  await expect(page.getByRole('button', { name: '本机直连', exact: true })).toBeVisible({ timeout: 15_000 });
  // 「在本设备启用 AI 教练」是总开关，默认关着；教练页的可点状态依赖它。
  const enable = page.getByRole('button', { name: '未启用', exact: true });
  if ((await enable.count()) > 0) await enable.click();
  await page.getByRole('button', { name: '本机直连', exact: true }).click();
}

async function fillDirect(page: Page, baseUrl: string, model: string, apiKey: string): Promise<void> {
  await page.getByLabel('模型服务地址（Base URL）').fill(baseUrl);
  await page.getByLabel('模型名称').fill(model);
  await page.getByLabel('API Key').fill(apiKey);
}

test.describe('AI 本机直连模式', () => {
  test('填好地址与密钥后可以完成一次真实的跨域调用', async ({ page }) => {
    const seen: Seen[] = [];
    const mock = await startMockProvider(seen, () => JSON.stringify({ reply: 'pong：直连可用', echo: 'logicdaily' }));
    try {
      await openDirectSettings(page);
      await expect(page.getByText('直连模式：密钥存在这台设备上')).toBeVisible();

      await fillDirect(page, `${mock.origin}/v1`, 'mock-model', TEST_KEY);
      await page.getByRole('button', { name: '测试连接', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: '连接正常：pong：直连可用' })).toBeVisible({ timeout: 20_000 });

      expect(seen.length, 'mock 服务商没有收到请求').toBeGreaterThan(0);
      const last = seen[seen.length - 1];
      // 密钥真的带上了，而且只发给用户填的那个地址。
      expect(last?.authorization).toBe(`Bearer ${TEST_KEY}`);
      expect(last?.model).toBe('mock-model');
      expect(last?.path).toBe('/v1/chat/completions');
      expect(last?.body).toContain('response_format');
    } finally {
      await closeServer(mock.server);
    }
  });

  test('缺少地址或密钥时给出可执行的提示，不发请求', async ({ page }) => {
    const seen: Seen[] = [];
    const mock = await startMockProvider(seen, () => JSON.stringify({ reply: '不该被调用', echo: 'logicdaily' }));
    try {
      await openDirectSettings(page);
      await page.getByLabel('模型服务地址（Base URL）').fill(`${mock.origin}/v1`);
      await page.getByLabel('模型名称').fill('mock-model');
      await page.getByRole('button', { name: '测试连接', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: '直连模式需要填写 API Key' })).toBeVisible({ timeout: 15_000 });
      expect(seen.length, '未填密钥就不该出站').toBe(0);

      await fillDirect(page, '', 'mock-model', TEST_KEY);
      await page.getByRole('button', { name: '测试连接', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: '直连模式需要填写模型服务地址' })).toBeVisible({ timeout: 15_000 });
      expect(seen.length, '未填地址就不该出站').toBe(0);
    } finally {
      await closeServer(mock.server);
    }
  });

  test('保存后刷新仍在，界面不显示明文，导出的备份里也没有密钥', async ({ page }) => {
    const seen: Seen[] = [];
    const mock = await startMockProvider(seen, () => JSON.stringify({ reply: 'pong：直连可用', echo: 'logicdaily' }));
    try {
      await openDirectSettings(page);
      await fillDirect(page, `${mock.origin}/v1`, 'mock-model', TEST_KEY);
      await page.getByRole('button', { name: '保存设置' }).click();
      await expect(page.getByText('有未保存的设置')).toHaveCount(0, { timeout: 15_000 });

      await page.reload();
      await expect(page.getByRole('button', { name: '本机直连', exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: '本机直连', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('模型服务地址（Base URL）')).toHaveValue(`${mock.origin}/v1`);

      // 密钥存在（遮罩提示），但输入框是 password 且页面上找不到明文。
      await page.getByRole('button', { name: '本机直连', exact: true }).click();
      await expect(page.getByText(`已保存在本机：sk…90（${TEST_KEY.length} 位）`)).toBeVisible();
      await expect(page.getByLabel('API Key')).toHaveAttribute('type', 'password');
      await expect(page.getByLabel('API Key')).toHaveValue(TEST_KEY);
      await expect(page.locator('body').getByText(TEST_KEY, { exact: true })).toHaveCount(0);

      // 「不进备份」是这条设计的核心承诺，这里真的导出一次证明它成立。
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出备份' }).click();
      const target = test.info().outputPath('direct-backup.json');
      await (await downloadPromise).saveAs(target);
      expect(existsSync(target)).toBe(true);
      const raw = readFileSync(target, 'utf8');
      expect(raw).not.toContain(TEST_KEY);
      expect(raw).not.toContain('"apiKey"');
      const payload = JSON.parse(raw) as { data: { settings: { ai: { mode: string; baseUrl: string } } } };
      expect(payload.data.settings.ai.mode).toBe('direct');
      expect(payload.data.settings.ai.baseUrl).toBe(`${mock.origin}/v1`);
    } finally {
      await closeServer(mock.server);
    }
  });

  test('直连仍然走同一套输出契约：模型返回不合结构就报错而不是透传', async ({ page }) => {
    const seen: Seen[] = [];
    const mock = await startMockProvider(seen, () => JSON.stringify({ notReply: 1 }));
    try {
      await openDirectSettings(page);
      await fillDirect(page, `${mock.origin}/v1`, 'mock-model', TEST_KEY);
      await page.getByRole('button', { name: '测试连接', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: '失败：模型返回的结构不符合要求' })).toBeVisible({ timeout: 20_000 });
      expect(seen.length).toBeGreaterThan(0);
    } finally {
      await closeServer(mock.server);
    }
  });

  test('教练页在直连模式下可用：材料分析把结构化结果渲染出来', async ({ page }) => {
    const seen: Seen[] = [];
    const mock = await startMockProvider(seen, (body) =>
      body.includes('连接测试') ? JSON.stringify({ reply: 'pong', echo: 'logicdaily' }) : JSON.stringify(MATERIAL_ANALYSIS),
    );
    try {
      await openDirectSettings(page);
      await fillDirect(page, `${mock.origin}/v1`, 'mock-model', TEST_KEY);
      await page.getByRole('button', { name: '保存设置' }).click();
      await expect(page.getByText('有未保存的设置')).toHaveCount(0, { timeout: 15_000 });

      await page.goto('/coach');
      // 直连模式下不该再出现「需要配置服务端」的说明——那正是真机上把用户挡在门外的文案。
      await expect(page.getByText('这个功能需要配置模型服务')).toHaveCount(0);
      await page.getByRole('button', { name: '示例：产品宣传' }).click();
      await page.getByRole('button', { name: '开始分析' }).click();
      await expect(page.getByText('新首页是这次增长的原因')).toBeVisible({ timeout: 20_000 });

      expect(seen.length).toBeGreaterThan(0);
      expect(seen[seen.length - 1]?.authorization).toBe(`Bearer ${TEST_KEY}`);
      expect(seen[seen.length - 1]?.path).toBe('/v1/chat/completions');
    } finally {
      await closeServer(mock.server);
    }
  });
});

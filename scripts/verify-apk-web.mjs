/**
 * 验证打进 APK 的离线前端包（apk-web/）确实可用。
 *
 * 这里用静态文件服务器模拟 Capacitor WebView 的加载环境，包括一个容易忽略的细节：
 * Capacitor 的 WebViewLocalServer 默认 html5mode=true，任何「最后一段不含点」的路径
 * （包括 /api/ai/status）都会被兜底成应用自己的 index.html 并返回 **200**，而不是 404。
 * 所以降级路径必须在「请求成功但拿回 HTML」这种情况下也成立——真机上就是这里漏出了
 * "Unexpected token '<'" 给用户。
 *
 * 除了降级，还验证「本机直连」这条真实通路：另起一个端口扮演 OpenAI 兼容服务商，
 * 让包内的页面跨端口、带预检地把一次分析请求发出去——这一步不需要 Node 服务端参与，
 * 正是 APK 里 AI 能用起来的唯一方式。用法：node scripts/verify-apk-web.mjs
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(process.cwd(), 'apk-web');
const PORT = 4321;
const PROVIDER_PORT = 4322;
const HARNESS_KEY = 'sk-apk-harness-key-0000000001';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

async function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const base = join(ROOT, normalize(clean).replace(/^(\.\.[/\\])+/, ''));
  const candidates = [base, join(base, 'index.html'), `${base}.html`];
  for (const file of candidates) {
    try {
      const info = await stat(file);
      if (info.isFile()) return file;
    } catch {
      /* 继续尝试下一个候选 */
    }
  }
  return null;
}

const server = createServer(async (request, response) => {
  const urlPath = (request.url ?? '/').split('?')[0];
  const file = await resolveFile(request.url ?? '/');
  if (!file) {
    const lastSegment = urlPath.replace(/\/+$/, '').split('/').pop() ?? '';
    // 复刻 Capacitor html5mode：无扩展名的路径返回应用外壳（200 + text/html）。
    if (!lastSegment.includes('.')) {
      try {
        const shell = await readFile(join(ROOT, 'index.html'));
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(shell);
        return;
      } catch {
        /* 外壳都不存在时落到 404 */
      }
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
    return;
  }
  const body = await readFile(file);
  const ext = file.slice(file.lastIndexOf('.'));
  response.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  response.end(body);
});

await new Promise((resolve) => server.listen(PORT, resolve));
console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}`);

/**
 * 假装的模型服务商：单独一个端口，于是包内页面发出的是一次真正的跨源请求（带预检），
 * 和真机上连 DeepSeek / Kimi 那一类接口的形状一致。
 */
const providerSeen = [];
const MATERIAL_ANALYSIS = {
  mainConclusion: '包内直连拿到的结论',
  premises: ['转化率从 2.1% 提升到 2.8%'],
  implicitAssumptions: ['同期没有别的变量在动'],
  fallacies: [{ name: '因果简化', where: '因此新首页有效', why: '把时间上的先后当成了因果' }],
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

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
};

const provider = createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, CORS);
    response.end();
    return;
  }
  let body = '';
  request.on('data', (chunk) => {
    body += String(chunk);
  });
  request.on('end', () => {
    providerSeen.push({ authorization: request.headers.authorization ?? null, path: request.url ?? null, body });
    // 连通性自检与材料分析共用一个端点，按提示词里的标记分流。
    const content = body.includes('连接测试')
      ? JSON.stringify({ reply: 'pong：包内直连可用', echo: 'logicdaily' })
      : JSON.stringify(MATERIAL_ANALYSIS);
    response.writeHead(200, { 'content-type': 'application/json', ...CORS });
    response.end(
      JSON.stringify({
        choices: [{ message: { content } }],
        model: 'apk-mock',
        usage: { prompt_tokens: 620, completion_tokens: 24, total_tokens: 644 },
      }),
    );
  });
});
await new Promise((resolve) => provider.listen(PROVIDER_PORT, '127.0.0.1', resolve));
console.log(`mock provider on http://127.0.0.1:${PROVIDER_PORT}/v1`);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
});
const page = await context.newPage();
const results = [];
function check(name, ok, detail = '') {
  const line = `${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`;
  results.push(line);
  console.log(line);
}

/** 轮询等待，避免用固定 sleep 猜播种耗时。 */
async function waitUntil(fn, timeoutMs = 25_000) {
  const started = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - started > timeoutMs) return false;
    await page.waitForTimeout(300);
  }
}

/**
 * 统计题库行数。store 尚未建立时 transaction() 会同步抛错，
 * 整段必须在 try 内返回哨兵值——否则 Promise 永不 settle，evaluate 会永久挂住。
 */
async function exerciseCount() {
  return page.evaluate(async () => {
    try {
      const db = await new Promise((resolve) => {
        const req = indexedDB.open('logicdaily');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!db) return -1;
      if (!db.objectStoreNames.contains('exercises')) return -2;
      const tx = db.transaction('exercises', 'readonly');
      return await new Promise((resolve) => {
        const req = tx.objectStore('exercises').count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(-3);
      });
    } catch {
      return -4;
    }
  });
}

try {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('main div', { timeout: 20_000 });
  // 引导卡要等 IndexedDB 播种完成、ready 置位后才渲染，所以轮询而不是立即断言。
  const guided = await waitUntil(async () => (await page.getByText('第一次使用？').count()) > 0);
  check('首页加载并出现引导', guided);

  const seeded = await waitUntil(async () => (await exerciseCount()) === 112);
  check('离线包内题库已播种（112 题）', seeded, `实际 ${await exerciseCount()}`);

  // 答题主流程
  await page.goto(`http://127.0.0.1:${PORT}/train/?exercise=ex-cond-001`);
  const group = page.getByRole('radiogroup', { name: '选择一个选项' });
  await group.waitFor({ timeout: 20_000 });
  check('深链接进入题目', (await group.count()) === 1);
  await group.getByRole('radio', { name: 'B 批次没有通过终检' }).click();
  await page.getByRole('button', { name: '提交作答' }).click();
  await page.getByText('答对').waitFor({ timeout: 15_000 });
  check('提交并判分', true);

  // AI 降级：没有服务端的构建里必须给出可读说明，绝不能漏出解析器文案。
  const RAW_PARSER_TEXT = /Unexpected token|is not valid JSON|SyntaxError/;
  for (const route of ['/me/', '/coach/']) {
    await page.goto(`http://127.0.0.1:${PORT}${route}`);
    // 状态探测是挂载后异步发出的，轮询到出现降级痕迹为止，别用固定 sleep 猜。
    await waitUntil(async () => {
      const text = await page.locator('body').innerText();
      return RAW_PARSER_TEXT.test(text) || /没有服务端|AI 教练未启用|这里连不上 AI 接口/.test(text);
    }, 15_000);
    const text = await page.locator('body').innerText();
    const leaked = RAW_PARSER_TEXT.test(text);
    const explained = /没有服务端|AI 教练未启用|这里连不上 AI 接口/.test(text);
    check(
      `${route} AI 优雅降级`,
      explained && !leaked,
      leaked ? `漏出解析器文案：${text.match(RAW_PARSER_TEXT)?.[0]}` : explained ? '' : '既无说明也无降级',
    );
  }

  // —— 本机直连：没有 Node 服务端的构建里，AI 只能靠这条通路 ——
  await page.goto(`http://127.0.0.1:${PORT}/me/`);
  const directChip = page.getByRole('button', { name: '本机直连', exact: true });
  const hasDirect = await waitUntil(async () => (await directChip.count()) > 0, 20_000);
  check('包内设置页出现直连选项', hasDirect, hasDirect ? '' : '没找到「本机直连」按钮');
  if (hasDirect) {
    await directChip.click();
    const enable = page.getByRole('button', { name: '未启用', exact: true });
    if ((await enable.count()) > 0) await enable.click();
    await page.getByLabel('模型服务地址（Base URL）').fill(`http://127.0.0.1:${PROVIDER_PORT}/v1`);
    await page.getByLabel('模型名称').fill('apk-mock');
    await page.getByLabel('API Key').fill(HARNESS_KEY);

    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    const pinged = await waitUntil(async () => /连接正常：pong：包内直连可用/.test(await page.locator('body').innerText()), 25_000);
    check('包内直连完成一次跨源调用', pinged);

    const last = providerSeen[providerSeen.length - 1];
    check(
      '直连请求带上 Bearer 且只发给填写的地址',
      last?.authorization === `Bearer ${HARNESS_KEY}` && last?.path === '/v1/chat/completions',
      last ? `${last.authorization} → ${last.path}` : '假装的服务商没有收到任何请求',
    );

    // 教练页读的是已保存的设置，不是页面上的草稿，所以这里必须先保存。
    await page.getByRole('button', { name: '保存设置' }).click();
    const saved = await waitUntil(async () => (await page.getByText('有未保存的设置').count()) === 0, 15_000);
    check('直连设置已保存', saved);

    await page.goto(`http://127.0.0.1:${PORT}/coach/`);
    const sample = page.getByRole('button', { name: '示例：产品宣传' });
    await sample.waitFor({ timeout: 20_000 });
    await sample.click();
    const analyze = page.getByRole('button', { name: '开始分析' });
    await analyze.waitFor({ timeout: 10_000 });
    const enabledForCoach = await analyze.isEnabled();
    check('直连填齐后教练按钮可用', enabledForCoach, enabledForCoach ? '' : '按钮仍是禁用状态');
    if (enabledForCoach) {
      await analyze.click();
      const analyzed = await waitUntil(async () => (await page.getByText('包内直连拿到的结论').count()) > 0, 25_000);
      check('包内教练页用直连拿到结构化分析', analyzed);
    }

    await page.goto(`http://127.0.0.1:${PORT}/me/`);
    const exportButton = page.getByRole('button', { name: '导出备份' });
    await exportButton.waitFor({ timeout: 20_000 });
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    const backupFile = await download.path();
    const backupText = backupFile ? await readFile(backupFile, 'utf8') : '';
    check(
      '导出的备份文件里既没有密钥也没有密钥字段',
      Boolean(backupText) && !backupText.includes(HARNESS_KEY) && !backupText.includes('"apiKey"'),
      backupText ? `备份 ${backupText.length} 字` : '没有取到备份内容',
    );
  }

  // 新的 ?edit= 路由是否在纯静态下可用
  await page.goto(`http://127.0.0.1:${PORT}/journal/`);
  await page
    .getByRole('link', { name: /新建|记录/ })
    .first()
    .click()
    .catch(() => undefined);
  await page.waitForTimeout(800);
  const titleInput = page.getByLabel('标题');
  await titleInput.waitFor({ timeout: 15_000 });
  await titleInput.fill('离线包里写的日志');
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForURL(/\/journal(\/)?\?edit=jr-/, { timeout: 15_000 });
  check('保存后 URL 变为 /journal?edit=<id>', /\/journal\/?\?edit=jr-/.test(page.url()), page.url());
  await page.reload();
  await page.waitForTimeout(1500);
  check('冷启动到 ?edit= 深链接后内容仍在', (await page.getByLabel('标题').inputValue()) === '离线包里写的日志');

  await page.goto(`http://127.0.0.1:${PORT}/journal/`);
  await page.waitForTimeout(1200);
  check('列表可见该篇日志', (await page.getByText('离线包里写的日志').count()) > 0);
  await page.getByText('离线包里写的日志').first().click();
  await page.waitForURL(/\/journal(\/)?\?edit=jr-/, { timeout: 15_000 });
  check('从列表点进编辑器', /\/journal\/?\?edit=jr-/.test(page.url()), page.url());

  for (const route of ['/review/', '/stats/', '/me/', '/train/', '/coach/']) {
    await page.goto(`http://127.0.0.1:${PORT}${route}`);
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${route} 无横向溢出`, overflow <= 1, `${overflow}px`);
  }
} catch (error) {
  results.push(`FAIL 未捕获异常 — ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
  server.close();
  provider.close();
}

console.log('\n' + results.join('\n'));
const failed = results.filter((line) => line.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed === 0 ? 0 : 1);

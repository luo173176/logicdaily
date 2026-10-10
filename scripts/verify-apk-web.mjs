/**
 * 验证打进 APK 的离线前端包（apk-web/）确实可用。
 *
 * 这里用静态文件服务器模拟 Capacitor WebView 的加载环境，包括一个容易忽略的细节：
 * Capacitor 的 WebViewLocalServer 默认 html5mode=true，任何「最后一段不含点」的路径
 * （包括 /api/ai/status）都会被兜底成应用自己的 index.html 并返回 **200**，而不是 404。
 * 所以降级路径必须在「请求成功但拿回 HTML」这种情况下也成立——真机上就是这里漏出了
 * "Unexpected token '<'" 给用户。用法：node scripts/verify-apk-web.mjs
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(process.cwd(), 'apk-web');
const PORT = 4321;

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

  // 新的 ?edit= 路由是否在纯静态下可用
  await page.goto(`http://127.0.0.1:${PORT}/journal/`);
  await page.getByRole('link', { name: /新建|记录/ }).first().click().catch(() => undefined);
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
}

console.log('\n' + results.join('\n'));
const failed = results.filter((line) => line.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed === 0 ? 0 : 1);

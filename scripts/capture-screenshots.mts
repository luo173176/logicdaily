/**
 * 生成 README 与文档里使用的真实截图（移动端视口）。
 * 用法：先 `npm run build && npm start`，再 `npx tsx scripts/capture-screenshots.mts`。
 */
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3123';
const OUT = 'docs/images';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
});
const page = await context.newPage();

async function shot(name: string, options?: { fullPage?: boolean }) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: options?.fullPage ?? false });
  console.log('captured', name);
}

async function ready() {
  // 页面主体是客户端渲染，等 IndexedDB 播种完成后再截图。
  await page.waitForSelector('main div', { timeout: 20_000 });
  await page.waitForTimeout(2000);
}

// 1. 首页（新用户的引导卡片）
await page.goto(`${BASE}/`);
await ready();
await page.waitForTimeout(1200);
await shot('01-home');

// 2. 新手引导
await page.goto(`${BASE}/onboarding`);
await ready();
await shot('02-onboarding');

// 3. 答题：固定一道单选题
await page.goto(`${BASE}/train?exercise=ex-cond-001`);
const group = page.getByRole('radiogroup', { name: '选择一个选项' });
await group.waitFor({ timeout: 20_000 });
await group.getByRole('radio', { name: 'B 批次通过了终检，但标签漏贴了' }).click();
await page.getByLabel('你的推理过程（建议写，写出来才能定位问题）').fill('如果终检通过就一定贴了绿色标签；B 批次没有标签，所以没有通过终检。');
await shot('03-train-question');

// 4. 提交后的解析与错因归类
await page.getByRole('button', { name: '提交作答' }).click();
await page.getByText('未答对').waitFor({ timeout: 15_000 });
await page.waitForTimeout(600);
await shot('04-train-result');

// 5. 复习页
await page.goto(`${BASE}/review`);
await ready();
await page.waitForTimeout(800);
await shot('05-review');

// 6. 思考日志：八步向导
await page.goto(`${BASE}/journal/new`);
await ready();
await page.getByLabel('标题').fill('要不要把评审会提前到周一');
await page.getByRole('button', { name: '保存' }).click();
await page.waitForURL(/\/journal\/[a-z0-9-]+$/i, { timeout: 15_000 });
await page.getByText('已保存到本机').waitFor({ timeout: 5_000 }).catch(() => undefined);
await page.waitForTimeout(400);
await shot('06-journal-wizard', { fullPage: true });

// 6b. 再答对一道题，让报告页有数据
await page.goto(`${BASE}/train?exercise=ex-cond-001`);
const group2 = page.getByRole('radiogroup', { name: '选择一个选项' });
await group2.waitFor({ timeout: 20_000 });
await group2.getByRole('radio', { name: 'B 批次没有通过终检' }).click();
await page.getByRole('button', { name: '提交作答' }).click();
await page.getByText('答对').waitFor({ timeout: 15_000 });

// 7. 日志列表
await page.goto(`${BASE}/journal`);
await ready();
await page.waitForTimeout(600);
await shot('07-journal-list');

// 8. 训练报告
await page.goto(`${BASE}/stats`);
await ready();
await page.waitForTimeout(1000);
await shot('08-stats');

// 9. 我的（设置与数据管理）
await page.goto(`${BASE}/me`);
await ready();
await page.waitForTimeout(800);
await shot('09-me', { fullPage: true });

// 10. 深色模式首页
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await page.goto(`${BASE}/`);
await ready();
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await page.waitForTimeout(500);
await shot('10-home-dark');

await browser.close();

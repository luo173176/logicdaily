import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

async function createJournal(page: Page, title: string, problem: string) {
  await page.goto('/journal/new');
  await page.getByLabel('标题').fill(title);
  await page.getByLabel('我要回答的问题').fill(problem);
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('button', { name: '已保存' })).toBeVisible();
  // 新建保存后地址会换成该篇的可分享地址，等导航稳定后再继续操作。
  await expect(page).toHaveURL(/\/journal\/jr-/);
}

test.describe('思考日志', () => {
  test('创建、编辑、搜索并刷新后仍在', async ({ page }) => {
    await createJournal(page, '为什么涨价后销量反而增加', '涨价通常抑制需求，这次为什么相反？');

    await page.goto('/journal');
    await expect(page.getByText('为什么涨价后销量反而增加')).toBeVisible();

    await page.getByLabel('搜索日志').fill('涨价');
    await expect(page.getByText('为什么涨价后销量反而增加')).toBeVisible();
    await page.getByLabel('搜索日志').fill('完全不存在的关键词zzz');
    await expect(page.getByText('没有匹配的日志')).toBeVisible();
  });

  test('八步向导与证据清单可以填写并保存', async ({ page }) => {
    await createJournal(page, '同事的反馈说明他不重视我吗', '他在评审会上否掉了我的方案。');
    await page.getByRole('button', { name: /第 2 步/ }).click();
    await page.getByLabel('区分事实、感受、推测与价值判断').fill('事实：他在会上提出了三点反对意见。');

    await page.getByRole('button', { name: '添加证据' }).click();
    await page.getByLabel('证据内容').fill('他上周也否掉了另一个人的方案');
    await page.getByRole('button', { name: '与结论冲突' }).click();
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('button', { name: '已保存' })).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: /第 2 步/ }).click();
    await expect(page.getByLabel('区分事实、感受、推测与价值判断')).toHaveValue('事实：他在会上提出了三点反对意见。');
    await expect(page.getByLabel('证据内容')).toHaveValue('他上周也否掉了另一个人的方案');
  });

  test('删除日志后列表不再显示', async ({ page }) => {
    await createJournal(page, '待删除的日志', '测试删除行为');
    await page.getByRole('button', { name: /删除这篇/ }).click();
    await page.goto('/journal');
    await expect(page.getByText('待删除的日志')).toHaveCount(0);
  });
});

test.describe('报告与数据管理', () => {
  test('训练报告能展示指标及其计算方式', async ({ page }) => {
    await page.goto('/train?exercise=ex-cond-001');
    await page.getByRole('radiogroup', { name: '选择一个选项' }).getByRole('radio', { name: 'B 批次没有通过终检' }).click();
    await page.getByRole('button', { name: '提交作答' }).click();
    await expect(page.locator('p.label', { hasText: '参考答案' })).toBeVisible();

    await page.goto('/stats');
    await expect(page.getByRole('heading', { name: '训练报告' })).toBeVisible();
    await expect(page.getByText('作答正确率')).toBeVisible();
    await page.getByText('怎么算').first().click();
    await expect(page.getByText(/答对数 \+ 部分正确数 × 0.5/)).toBeVisible();
    await expect(page.getByText('这些数字不能说明什么')).toBeVisible();
  });

  test('导出备份 → 清除数据 → 导入恢复', async ({ page }) => {
    await createJournal(page, '需要被备份的日志', '备份与恢复');
    await page.goto('/me');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出备份' }).click();
    const download = await downloadPromise;
    const target = test.info().outputPath('backup.json');
    await download.saveAs(target);
    expect(existsSync(target)).toBe(true);
    const payload = JSON.parse(readFileSync(target, 'utf8')) as { app: string; data: { journals: unknown[] } };
    expect(payload.app).toBe('logicdaily');
    expect(payload.data.journals.length).toBeGreaterThanOrEqual(1);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '清除本地数据' }).click();
    await expect(page.getByText('本地数据已清除')).toBeVisible({ timeout: 10_000 });

    await page.goto('/me');
    await page.setInputFiles('input[type="file"]', target);
    await expect(page.getByText(/导入完成/)).toBeVisible({ timeout: 15_000 });

    await page.goto('/journal');
    await expect(page.getByText('需要被备份的日志')).toBeVisible();
  });

  test('拒绝结构不合法的导入文件', async ({ page }) => {
    await page.goto('/me');
    const bad = test.info().outputPath('bad.json');
    await (await import('node:fs/promises')).writeFile(bad, JSON.stringify({ hello: 'world' }), 'utf8');
    await page.setInputFiles('input[type="file"]', bad);
    await expect(page.getByText(/导入被拒绝/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/导入完成/)).toHaveCount(0);
  });
});

test.describe('AI 降级与错误处理', () => {
  test.beforeEach(async ({ page }) => {
    // Service Worker 会拦截请求，导致路由桩不稳定；测试里先注销。
    await page.goto('/');
    await page.evaluate(async () => {
      const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(registrations.map((registration) => registration.unregister()));
      const keys = (await caches?.keys?.()) ?? [];
      await Promise.all(keys.map((key) => caches.delete(key)));
    });
  });
  test('未配置模型时，教练功能给出说明且不影响训练', async ({ page }) => {
    await page.goto('/coach');
    await expect(page.getByText('这个功能需要配置模型服务')).toBeVisible();
    await page.goto('/train?exercise=ex-cond-001');
    const submit = page.getByRole('button', { name: '提交作答' });
    await expect(submit).toBeVisible();
    await expect(submit).toBeDisabled();
    await page.getByRole('radiogroup', { name: '选择一个选项' }).getByRole('radio', { name: 'B 批次没有通过终检' }).click();
    await expect(submit).toBeEnabled();
  });

  test('模型服务报错时界面给出可理解的提示', async ({ page }) => {
    await page.route('**/api/ai/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          configured: true,
          defaultModel: 'test-model',
          allowedBaseUrlCount: 1,
          allowClientBaseUrl: false,
          limits: {},
        }),
      }),
    );
    await page.route('**/api/ai/analyze', (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, code: 'bad_response', message: '模型返回的结果不符合结构要求，已丢弃，请重试。' }),
      }),
    );

    await page.goto('/coach');
    await page.getByRole('button', { name: '示例：健康类推文' }).click();
    await page.getByRole('button', { name: '开始分析' }).click();
    await expect(page.getByText('分析失败')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/模型返回的结果不符合结构要求/)).toBeVisible();
  });

  test('限流响应会提示稍后再试', async ({ page }) => {
    await page.route('**/api/ai/status', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, configured: true }) }),
    );
    await page.route('**/api/ai/analyze', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: { 'retry-after': '30' },
        body: JSON.stringify({ ok: false, code: 'rate_limited', message: '调用过于频繁或已达当日上限。', retryAfterSeconds: 30 }),
      }),
    );
    await page.goto('/coach');
    await page.getByRole('button', { name: '示例：产品宣传' }).click();
    await page.getByRole('button', { name: '开始分析' }).click();
    await expect(page.getByText(/调用过于频繁/)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('手机视口', () => {
  test('各主要页面在 393×851 下无横向溢出且导航可用', async ({ page }) => {
    for (const path of ['/', '/train', '/journal', '/review', '/me', '/stats', '/coach', '/offline']) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} 横向溢出 ${overflow}px`).toBeLessThanOrEqual(1);
    }
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: '主导航' });
    await expect(nav.getByRole('link', { name: '首页' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '训练' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '日志' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '复习' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '我的' })).toBeVisible();
  });

  test('长文本输入不会被底部导航遮挡', async ({ page }) => {
    await page.goto('/journal/new');
    const box = await page.getByLabel('我要回答的问题').boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThan(viewport!.height);
  });
});

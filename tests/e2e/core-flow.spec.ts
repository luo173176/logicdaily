import { expect, test, type Page } from '@playwright/test';

/** 每个页面都不允许出现横向溢出（手机屏上的硬性要求）。 */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `页面出现横向滚动 ${overflow}px`).toBeLessThanOrEqual(1);
}

// 固定一道单选题（ex-cond-001，否定后件式），避免“今日计划”随日期变化导致测试不稳定。
const TARGET = '/train?exercise=ex-cond-001';
const CORRECT_OPTION = 'B 批次没有通过终检';
const TRAP_OPTION = 'B 批次通过了终检，但标签漏贴了';

async function openTarget(page: Page) {
  await page.goto(TARGET);
  const group = page.getByRole('radiogroup', { name: '选择一个选项' });
  await expect(group).toBeVisible({ timeout: 20_000 });
  return group;
}

test.describe('首次使用与核心训练流程', () => {
  test('新用户打开首页会看到引导与开始入口', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('第一次使用？')).toBeVisible();
    await expect(page.getByRole('link', { name: '开始今天的训练' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('新手引导逐步完成后进入训练', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page.getByRole('heading', { level: 1, name: '每天能投入多少时间？' })).toBeVisible();
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByText('选择感兴趣的训练方向')).toBeVisible();
    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByRole('button', { name: '开始第一道题' }).click();
    await page.waitForURL('**/train');
    await expect(page.getByRole('heading', { name: '今天的训练' })).toBeVisible();
  });

  test('完成一道题：作答、写推理、提交、看解析', async ({ page }) => {
    const group = await openTarget(page);
    await expect(page.getByRole('heading', { level: 1, name: /车间规定/ })).toBeVisible();
    await group.getByRole('radio', { name: CORRECT_OPTION }).click();
    await page.getByLabel('你的推理过程（建议写，写出来才能定位问题）').fill('没有贴绿色标签说明后件不成立，因此按否定后件式推出没有通过终检。');
    await page.getByRole('radiogroup', { name: '你对这个答案的信心程度' }).getByRole('radio', { name: '4 · 比较确定' }).click();
    await page.getByRole('button', { name: '提交作答' }).click();

    await expect(page.getByText('答对')).toBeVisible();
    await expect(page.locator('p.label', { hasText: '参考答案' })).toBeVisible();
    await expect(page.getByText('否定后件式')).toBeVisible();
    await expect(page.getByText(/^记住：/)).toBeVisible();
    await expect(page.getByText(/AI 教练未启用|服务端还没有模型凭据|AI 思维教练/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('命中典型错误时给出错因归类，并能标记题目歧义', async ({ page }) => {
    const group = await openTarget(page);
    await group.getByRole('radio', { name: TRAP_OPTION }).click();
    await page.getByRole('button', { name: '提交作答' }).click();

    await expect(page.getByText('未答对')).toBeVisible();
    await expect(page.getByText('典型错误：否定前件')).toBeVisible();
    await expect(page.getByText(/这次更像下面哪种情况/)).toBeVisible();
    await page.getByRole('button', { name: '题目本身有歧义' }).click();
    await expect(page.getByText(/已标记题目歧义/)).toBeVisible();

    await page.goto('/me');
    await expect(page.getByText('题库复核清单')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'ex-cond-001' })).toHaveCount(1);
  });

  test('答错后给出次日复习说明，复习页可用', async ({ page }) => {
    const group = await openTarget(page);
    await group.getByRole('radio', { name: TRAP_OPTION }).click();
    await page.getByRole('button', { name: '提交作答' }).click();
    await expect(page.getByText(/明天再练一次/)).toBeVisible();

    await page.goto('/review');
    await expect(page.getByRole('heading', { name: '复习' })).toBeVisible();
    const hasQueue = await page.getByRole('link', { name: '开始复习' }).count();
    const isEmpty = await page.getByText(/今天没有到期复习/).count();
    expect(hasQueue + isEmpty).toBeGreaterThanOrEqual(1);
    await expect(page.getByText('复习调度规则怎么运作')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('刷新页面后作答记录仍然存在', async ({ page }) => {
    const group = await openTarget(page);
    await group.getByRole('radio', { name: CORRECT_OPTION }).click();
    await page.getByRole('button', { name: '提交作答' }).click();
    await expect(page.getByText('答对')).toBeVisible();

    await page.goto('/stats');
    await expect(page.getByRole('listitem').filter({ hasText: '1 题' }).first()).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByRole('listitem').filter({ hasText: '1 题' }).first()).toBeVisible();
  });
});

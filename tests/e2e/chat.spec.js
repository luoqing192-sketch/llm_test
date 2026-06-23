import { test, expect } from '@playwright/test';

test.describe('聊天流程', () => {
  test('用户应该能够登录并发送消息', async ({ page }) => {
    await page.goto('http://localhost:3000/login');
    
    // 登录
    await page.fill('input[name=username]', 'admin');
    await page.fill('input[name=password]', 'admin123');
    await page.click('button[type=submit]');
    
    // 等待跳转
    await page.waitForURL('/chat');
    
    // 创建新对话
    await page.click('text=新对话');
    
    // 发送消息
    await page.fill('textarea[name=message]', '你好，这是一个测试消息');
    await page.click('button:has-text("发送")');
    
    // 检查是否有排队提示
    const queueIndicator = page.locator('.queue-indicator');
    if (await queueIndicator.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(queueIndicator).toContainText('排队中');
      // 等待排队完成
      await expect(queueIndicator).not.toBeVisible({ timeout: 60000 });
    }
    
    // 检查 AI 回复
    await expect(page.locator('.message.assistant')).toBeVisible({ timeout: 60000 });
  });
});

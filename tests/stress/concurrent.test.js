import { describe, it, expect } from 'vitest';
import axios from 'axios';

describe('压力测试', () => {
  const baseUrl = 'http://localhost:3000';
  let token;

  it('应该处理 100 个并发请求', async () => {
    // 登录
    const loginRes = await axios.post(`${baseUrl}/api/auth/login`, {
      username: 'admin',
      password: 'admin123'
    });
    token = loginRes.data.token;

    // 创建对话
    const convRes = await axios.post(
      `${baseUrl}/api/conversations`,
      { title: '压力测试' },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const conversationId = convRes.data.id;

    // 发送 100 个并发请求
    console.log('发送 100 个并发请求...');
    const startTime = Date.now();

    const promises = Array.from({ length: 100 }, (_, i) =>
      axios.post(
        `${baseUrl}/api/chat`,
        { conversationId, message: `消息 ${i + 1}` },
        { 
          headers: { Authorization: `Bearer ${token}` },
          timeout: 120000
        }
      ).catch(err => err.response || { status: 0, data: err.message })
    );

    const results = await Promise.all(promises);
    const duration = Date.now() - startTime;

    // 统计结果
    const success = results.filter(r => r.status === 200).length;
    const queued = results.filter(r => r.status === 202).length;
    const rejected = results.filter(r => r.status === 503).length;
    const timeout = results.filter(r => r.status === 0).length;

    console.log(`
压力测试结果：
- 总请求数：100
- 成功：${success}
- 排队中：${queued}
- 拒绝：${rejected}
- 超时：${timeout}
- 总耗时：${duration}ms
- 平均响应时间：${duration / 100}ms
    `);

    // 至少 80% 应该成功或排队
    expect((success + queued) / 100).toBeGreaterThan(0.8);
  }, 180000); // 3 分钟超时
});

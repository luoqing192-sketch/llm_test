import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../app.js';

describe('Chat API', () => {
  let token;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    token = res.body.token;
  });

  it('GET /api/health 应该返回健康状态', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('POST /api/conversations 应该创建对话', async () => {
    const res = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '测试对话' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body.title).toBe('测试对话');
  });

  it('GET /api/conversations 应该返回对话列表', async () => {
    const res = await request(app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/queue/status 应该返回队列状态', async () => {
    const res = await request(app)
      .get('/api/queue/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('pending');
    expect(res.body).toHaveProperty('active');
    expect(res.body).toHaveProperty('maxConcurrent');
  });

  it('POST /api/auth/login 无效凭据应该返回401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/conversations 无token应该返回401', async () => {
    const res = await request(app).get('/api/conversations');
    // Express may return 401 or the auth middleware may handle it
    expect([401, 403]).toContain(res.status);
  });
});

# AI Chat Assistant 技术设计文档

## 1. 项目概述

### 1.1 产品定位
企业级对话 AI 平台，提供可扩展的 AI 对话能力，支持高并发、知识库检索、管理员完全控制。

### 1.2 目标用户
- **管理员**: 管理 LLM 模型配置、提示词模板、知识库文档、用户权限
- **终端用户**: 与 AI 进行多轮对话，获取知识库支持的回答

### 1.3 核心功能
- 多轮对话管理（会话隔离、自动命名）
- LLM 模型动态配置（API 地址、密钥、参数）
- 提示词管理（创建、编辑、测试、激活）
- 知识库管理（文档上传、向量化检索）
- 高并发排队机制（LLM 请求限流）
- 用户认证与权限管理

---

## 2. 技术架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend                            │
│  React 18 + TypeScript + Zustand + Ant Design 5         │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP/WebSocket
┌────────────────────▼────────────────────────────────────┐
│                   API Gateway                            │
│              Express.js + Rate Limiting                  │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┴────────────┬────────────┐
        │                         │            │
┌───────▼────────┐  ┌────────────▼─────────┐ ┌▼──────────┐
│  LLM Queue     │  │  Knowledge Base      │ │  MySQL    │
│  (Redis/Mem)   │  │  (Qdrant Vector DB)  │ │  (Pool)   │
└───────┬────────┘  └────────────┬─────────┘ └───────────┘
        │                         │
┌───────▼────────┐  ┌────────────▼─────────┐
│  LLM Providers │  │  Embedding Service   │
│  (OpenAI/Qwen) │  │  (text-embedding-3)  │
└────────────────┘  └──────────────────────┘
```

### 2.2 技术栈选型

#### Frontend
- **React 18**: 并发特性、Suspense
- **TypeScript**: 类型安全
- **Zustand**: 轻量状态管理（vs Redux 更简洁）
- **Ant Design 5**: 企业级 UI 组件库
- **Vite**: 快速构建工具
- **React Query**: 服务端状态管理
- **React Router v6**: 路由管理

#### Backend
- **Node.js 22+**: 高性能运行时
- **Express.js**: Web 框架
- **mysql2**: MySQL 连接池
- **@qdrant/js-client-rest**: 向量数据库客户端
- **OpenAI SDK**: LLM API 调用
- **JWT**: 身份认证
- **Multer**: 文件上传

#### Infrastructure
- **MySQL 8.0**: 关系型数据库（连接池）
- **Qdrant**: 向量数据库（文档检索）
- **Redis**: 队列管理（可选，当前用内存队列）
- **Docker**: 容器化部署
- **systemd**: 进程管理

---

## 3. 数据库设计

### 3.1 连接池配置

```javascript
// db.js
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  
  // 连接池配置
  waitForConnections: true,
  connectionLimit: 20,        // 最大连接数
  queueLimit: 100,            // 等待队列长度（0 = 无限）
  acquireTimeout: 60000,      // 获取连接超时（60s）
  timeout: 60000,             // 连接超时
  reconnect: true,            // 自动重连
  
  // 性能优化
  multipleStatements: false,  // 禁用多语句（安全）
  charset: 'utf8mb4',         // 支持 emoji
  dateStrings: true,          // 返回日期字符串
});
```

### 3.2 表结构

#### users（用户表）
```sql
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'user') DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username (username),
  INDEX idx_role (role)
);
```

#### conversations（对话表）
```sql
CREATE TABLE conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at)
);
```

#### messages（消息表）
```sql
CREATE TABLE messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  INDEX idx_conversation_id (conversation_id),
  INDEX idx_created_at (created_at)
);
```

#### settings（配置表）
```sql
CREATE TABLE settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

#### prompts（提示词表）
```sql
CREATE TABLE prompts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_is_active (is_active)
);
```

#### knowledge_bases（知识库表）
```sql
CREATE TABLE knowledge_bases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
```

#### documents（文档表）
```sql
CREATE TABLE documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  knowledge_base_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size BIGINT,
  status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
  error_message TEXT,
  uploaded_by INT,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id),
  INDEX idx_status (status),
  INDEX idx_knowledge_base_id (knowledge_base_id)
);
```

---

## 4. LLM 队列机制

### 4.1 设计目标
- 限制并发 LLM 请求数（防止 API 限流）
- 公平排队（FIFO）
- 用户可见的排队状态反馈
- 超时自动取消

### 4.2 实现方案

```typescript
// queue/llm-queue.ts
interface QueueItem {
  id: string;
  userId: number;
  conversationId: number;
  request: LLMRequest;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  enqueuedAt: number;
  position: number;
}

class LLMQueue {
  private queue: QueueItem[] = [];
  private activeRequests = 0;
  private readonly maxConcurrent = 5;  // 最大并发数
  private readonly timeoutMs = 60000;  // 请求超时

  async enqueue(request: LLMRequest): Promise<LLMResponse> {
    return new Promise((resolve, reject) => {
      const item: QueueItem = {
        id: generateId(),
        userId: request.userId,
        conversationId: request.conversationId,
        request,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        position: this.queue.length + 1,
      };

      this.queue.push(item);
      this.processQueue();

      // 超时取消
      setTimeout(() => {
        const index = this.queue.findIndex(q => q.id === item.id);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error('Request timeout'));
        }
      }, this.timeoutMs);
    });
  }

  private async processQueue() {
    if (this.activeRequests >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeRequests++;

    try {
      const response = await this.executeLLMRequest(item.request);
      item.resolve(response);
    } catch (error) {
      item.reject(error);
    } finally {
      this.activeRequests--;
      this.updatePositions();
      this.processQueue();
    }
  }

  private updatePositions() {
    this.queue.forEach((item, index) => {
      item.position = index + 1;
    });
  }

  getQueueStatus() {
    return {
      pending: this.queue.length,
      active: this.activeRequests,
      estimatedWaitTime: this.queue.length * 5000, // 每请求约5秒
    };
  }
}

export const llmQueue = new LLMQueue();
```

### 4.3 API 端点

```typescript
// POST /api/chat (queued)
app.post('/api/chat', async (req, res) => {
  const { conversationId, message } = req.body;
  
  try {
    // 入队
    const response = await llmQueue.enqueue({
      userId: req.user.id,
      conversationId,
      message,
    });

    res.json(response);
  } catch (error) {
    res.status(503).json({ 
      error: 'Service temporarily unavailable',
      queueStatus: llmQueue.getQueueStatus()
    });
  }
});

// GET /api/queue/status
app.get('/api/queue/status', (req, res) => {
  res.json(llmQueue.getQueueStatus());
});
```

### 4.4 前端排队提示

```tsx
// components/QueueIndicator.tsx
import { useEffect, useState } from 'react';
import { Progress, Typography } from 'antd';

export function QueueIndicator() {
  const [status, setStatus] = useState<QueueStatus | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch('/api/queue/status');
      const data = await res.json();
      setStatus(data);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  if (!status || status.pending === 0) return null;

  const waitMinutes = Math.ceil(status.estimatedWaitTime / 60000);

  return (
    <div className="queue-indicator">
      <Typography.Text type="warning">
        当前排队中，前方还有 {status.pending} 人
      </Typography.Text>
      <Progress 
        percent={100 - (status.pending * 10)} 
        status="active"
        strokeColor="#F59E0B"
      />
      <Typography.Text type="secondary">
        预计等待时间：{waitMinutes} 分钟
      </Typography.Text>
    </div>
  );
}
```

---

## 5. 环境配置

### 5.1 环境分离

```
config/
├── .env.development    # 本地开发
├── .env.staging        # 预发环境
└── .env.production     # 线上环境
```

#### .env.development
```bash
NODE_ENV=development
PORT=3000
MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=chatapp_dev
LLM_API_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-***
LLM_MAX_CONCURRENT=2
LOG_LEVEL=debug
```

#### .env.staging
```bash
NODE_ENV=staging
PORT=3000
MYSQL_HOST=staging-db.example.com
MYSQL_USER=chatapp
MYSQL_PASSWORD=***
MYSQL_DATABASE=chatapp_staging
MYSQL_CONNECTION_LIMIT=15
LLM_API_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-***
LLM_MAX_CONCURRENT=3
LOG_LEVEL=info
```

#### .env.production
```bash
NODE_ENV=production
PORT=3000
MYSQL_HOST=prod-db.example.com
MYSQL_USER=chatapp
MYSQL_PASSWORD=***
MYSQL_DATABASE=chatapp_prod
MYSQL_CONNECTION_LIMIT=30
LLM_API_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-***
LLM_MAX_CONCURRENT=10
LOG_LEVEL=warn
```

### 5.2 环境启动脚本

```bash
# scripts/start-staging.sh
export NODE_ENV=staging
node server.js

# scripts/start-production.sh
export NODE_ENV=production
node server.js
```

---

## 6. 前端架构（React + TypeScript + Zustand）

### 6.1 项目结构

```
frontend/
├── src/
│   ├── components/          # 通用组件
│   │   ├── ChatMessage/
│   │   ├── ConversationList/
│   │   ├── QueueIndicator/
│   │   └── AdminPanel/
│   ├── pages/               # 页面组件
│   │   ├── Chat/
│   │   ├── Login/
│   │   └── Admin/
│   ├── stores/              # Zustand 状态管理
│   │   ├── authStore.ts
│   │   ├── chatStore.ts
│   │   ├── adminStore.ts
│   │   └── queueStore.ts
│   ├── services/            # API 调用
│   │   ├── api.ts
│   │   ├── chatService.ts
│   │   └── adminService.ts
│   ├── types/               # TypeScript 类型
│   │   ├── user.ts
│   │   ├── conversation.ts
│   │   └── message.ts
│   ├── hooks/               # 自定义 Hooks
│   │   ├── useChat.ts
│   │   └── useQueue.ts
│   ├── utils/               # 工具函数
│   ├── styles/              # 全局样式
│   ├── App.tsx
│   └── main.tsx
├── tests/                   # 测试文件
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── mocks/                   # Mock 数据
│   ├── handlers.ts
│   └── data.ts
└── package.json
```

### 6.2 状态管理（Zustand）

```typescript
// stores/chatStore.ts
import { create } from 'zustand';

interface ChatState {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  messages: Message[];
  isLoading: boolean;
  
  // Actions
  fetchConversations: () => Promise<void>;
  createConversation: () => Promise<Conversation>;
  sendMessage: (content: string) => Promise<void>;
  setCurrentConversation: (conv: Conversation) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversation: null,
  messages: [],
  isLoading: false,

  fetchConversations: async () => {
    const res = await chatService.getConversations();
    set({ conversations: res.data });
  },

  createConversation: async () => {
    const res = await chatService.createConversation();
    set(state => ({
      conversations: [res.data, ...state.conversations]
    }));
    return res.data;
  },

  sendMessage: async (content: string) => {
    set({ isLoading: true });
    
    try {
      const conv = get().currentConversation;
      if (!conv) throw new Error('No conversation selected');

      // 添加用户消息到 UI
      const userMessage: Message = {
        id: Date.now(),
        role: 'user',
        content,
        createdAt: new Date(),
      };
      set(state => ({ messages: [...state.messages, userMessage] }));

      // 发送到后端（会进入队列）
      await chatService.sendMessage(conv.id, content);

      // 刷新消息列表
      const res = await chatService.getMessages(conv.id);
      set({ messages: res.data });
    } finally {
      set({ isLoading: false });
    }
  },

  setCurrentConversation: (conv) => {
    set({ currentConversation: conv, messages: [] });
  },
}));
```

### 6.3 设计系统

#### Color Palette
```
Primary:    #0F172A (深蓝灰) - 背景
Secondary:  #1E293B (浅蓝灰) - 卡片
Accent:     #06B6D4 (电子蓝) - 主要按钮、链接
Success:    #10B981 (翠绿) - 成功状态
Warning:    #F59E0B (琥珀) - 警告、排队
Error:      #EF4444 (红色) - 错误状态
Text:       #F8FAFC (浅白) - 主文本
Muted:      #94A3B8 (灰蓝) - 次要文本
```

#### Typography
```
Display:    Space Grotesk (标题、大数字)
Body:       Inter (正文、UI 文本)
Mono:       JetBrains Mono (代码、API 密钥)
```

#### Signature Element
**排队等待动画** — 脉动的圆环 + 队列位置数字 + 预计等待时间，使用电子蓝渐变色。

---

## 7. 测试策略

### 7.1 测试金字塔

```
        ┌─────────────┐
        │   E2E Tests │  (10%)
        │  Playwright │
        ├─────────────┤
        │ Integration │  (30%)
        │    Tests    │
        ├─────────────┤
        │ Unit Tests  │  (60%)
        │  Jest/Vitest│
        └─────────────┘
```

### 7.2 单元测试

```typescript
// tests/unit/llm-queue.test.ts
import { describe, it, expect } from 'vitest';
import { LLMQueue } from '../../src/queue/llm-queue';

describe('LLMQueue', () => {
  it('should process requests in FIFO order', async () => {
    const queue = new LLMQueue({ maxConcurrent: 1 });
    const results: number[] = [];

    const promises = [1, 2, 3].map(i =>
      queue.enqueue({ userId: 1, conversationId: 1, message: `test ${i}` })
        .then(() => results.push(i))
    );

    await Promise.all(promises);
    expect(results).toEqual([1, 2, 3]);
  });

  it('should respect max concurrent limit', async () => {
    const queue = new LLMQueue({ maxConcurrent: 2 });
    let activeCount = 0;
    let maxActive = 0;

    const task = () => new Promise(resolve => {
      activeCount++;
      maxActive = Math.max(maxActive, activeCount);
      setTimeout(() => {
        activeCount--;
        resolve(null);
      }, 100);
    });

    await Promise.all([task(), task(), task(), task()]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('should timeout after configured duration', async () => {
    const queue = new LLMQueue({ maxConcurrent: 1, timeoutMs: 100 });
    
    // Block the queue
    queue.enqueue({ userId: 1, conversationId: 1, message: 'block' });

    // This should timeout
    await expect(
      queue.enqueue({ userId: 1, conversationId: 1, message: 'timeout' })
    ).rejects.toThrow('Request timeout');
  });
});
```

### 7.3 集成测试

```typescript
// tests/integration/api.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/server';

describe('Chat API', () => {
  let token: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    token = res.body.token;
  });

  it('should create conversation', async () => {
    const res = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Test' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  it('should send message and queue if busy', async () => {
    // Send multiple concurrent requests
    const promises = Array.from({ length: 10 }, () =>
      request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ conversationId: 1, message: 'test' })
    );

    const responses = await Promise.all(promises);
    
    // Some should succeed, some might be queued
    responses.forEach(res => {
      expect([200, 202, 503]).toContain(res.status);
    });
  });
});
```

### 7.4 E2E 测试（Playwright）

```typescript
// tests/e2e/chat.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Chat Flow', () => {
  test('user can send message and receive response', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name=username]', 'testuser');
    await page.fill('[name=password]', 'password');
    await page.click('button[type=submit]');

    await page.click('text=新对话');
    await page.fill('[name=message]', '你好');
    await page.click('button:has-text("发送")');

    // Wait for queue indicator if present
    const queueIndicator = page.locator('.queue-indicator');
    if (await queueIndicator.isVisible()) {
      await expect(queueIndicator).toContainText('排队中');
      await expect(queueIndicator).not.toBeVisible({ timeout: 60000 });
    }

    // Check response
    await expect(page.locator('.message.assistant')).toBeVisible();
  });
});
```

### 7.5 压力测试

```typescript
// tests/stress/concurrent.test.ts
import { describe, it, expect } from 'vitest';
import axios from 'axios';

describe('Stress Test', () => {
  it('should handle 100 concurrent requests', async () => {
    const baseUrl = 'http://localhost:3000';
    
    // Login
    const { data: { token } } = await axios.post(`${baseUrl}/api/auth/login`, {
      username: 'admin',
      password: 'admin123'
    });

    // Create conversation
    const { data: conv } = await axios.post(`${baseUrl}/api/conversations`, 
      { title: 'Stress Test' },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // Send 100 concurrent requests
    const promises = Array.from({ length: 100 }, (_, i) =>
      axios.post(`${baseUrl}/api/chat`,
        { conversationId: conv.id, message: `Message ${i}` },
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(err => err.response)
    );

    const results = await Promise.all(promises);

    // Analyze results
    const success = results.filter(r => r.status === 200).length;
    const queued = results.filter(r => r.status === 202).length;
    const rejected = results.filter(r => r.status === 503).length;

    console.log(`Success: ${success}, Queued: ${queued}, Rejected: ${rejected}`);

    // At least 80% should succeed or be queued
    expect((success + queued) / 100).toBeGreaterThan(0.8);
  });
});
```

---

## 8. Mock 数据

### 8.1 用户数据

```typescript
// mocks/data/users.ts
export const mockUsers = [
  {
    id: 1,
    username: 'admin',
    password_hash: '$2a$10$...', // bcrypt hash of 'admin123'
    role: 'admin',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 2,
    username: 'testuser',
    password_hash: '$2a$10$...',
    role: 'user',
    created_at: '2024-01-02T00:00:00Z',
  },
];
```

### 8.2 对话数据

```typescript
// mocks/data/conversations.ts
export const mockConversations = [
  {
    id: 1,
    user_id: 1,
    title: '关于 React 的讨论',
    created_at: '2024-01-10T10:00:00Z',
    updated_at: '2024-01-10T10:30:00Z',
  },
  {
    id: 2,
    user_id: 1,
    title: '知识库检索测试',
    created_at: '2024-01-11T14:00:00Z',
    updated_at: '2024-01-11T14:20:00Z',
  },
];
```

### 8.3 消息数据

```typescript
// mocks/data/messages.ts
export const mockMessages = [
  {
    id: 1,
    conversation_id: 1,
    role: 'user',
    content: '什么是 React？',
    created_at: '2024-01-10T10:00:00Z',
  },
  {
    id: 2,
    conversation_id: 1,
    role: 'assistant',
    content: 'React 是一个用于构建用户界面的 JavaScript 库，由 Facebook 开发。它使用组件化的方式...',
    created_at: '2024-01-10T10:00:05Z',
  },
];
```

### 8.4 MSW Handlers

```typescript
// mocks/handlers.ts
import { http, HttpResponse } from 'msw';
import { mockUsers, mockConversations, mockMessages } from './data';

export const handlers = [
  http.post('/api/auth/login', async ({ request }) => {
    const { username, password } = await request.json();
    const user = mockUsers.find(u => u.username === username);
    
    if (user) {
      return HttpResponse.json({
        token: 'mock-jwt-token',
        user: { id: user.id, username: user.username, role: user.role },
      });
    }
    
    return HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }),

  http.get('/api/conversations', () => {
    return HttpResponse.json(mockConversations);
  }),

  http.post('/api/conversations', async ({ request }) => {
    const { title } = await request.json();
    const newConv = {
      id: mockConversations.length + 1,
      user_id: 1,
      title,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return HttpResponse.json(newConv, { status: 201 });
  }),

  http.post('/api/chat', async ({ request }) => {
    // Simulate queue delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return HttpResponse.json({
      id: Date.now(),
      role: 'assistant',
      content: '这是一个模拟的 AI 回复。',
      created_at: new Date().toISOString(),
    });
  }),

  http.get('/api/queue/status', () => {
    return HttpResponse.json({
      pending: Math.floor(Math.random() * 5),
      active: Math.floor(Math.random() * 3),
      estimatedWaitTime: Math.floor(Math.random() * 30000),
    });
  }),
];
```

---

## 9. 部署与监控

### 9.1 Docker 部署

```dockerfile
# Dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - MYSQL_HOST=mysql
      - QDRANT_HOST=qdrant
    depends_on:
      - mysql
      - qdrant
    restart: always

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ***
      MYSQL_DATABASE: chatapp_prod
    volumes:
      - mysql_data:/var/lib/mysql
    ports:
      - "3306:3306"

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage

volumes:
  mysql_data:
  qdrant_data:
```

### 9.2 监控指标

```typescript
// monitoring/metrics.ts
import prometheus from 'prom-client';

const register = new prometheus.Registry();

// HTTP 请求计数
const httpRequests = new prometheus.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
});

// LLM 队列长度
const queueLength = new prometheus.Gauge({
  name: 'llm_queue_length',
  help: 'Current LLM queue length',
});

// LLM 请求延迟
const llmLatency = new prometheus.Histogram({
  name: 'llm_request_duration_seconds',
  help: 'LLM request duration in seconds',
  buckets: [1, 5, 10, 30, 60],
});

register.registerMetric(httpRequests);
register.registerMetric(queueLength);
register.registerMetric(llmLatency);

export { register, httpRequests, queueLength, llmLatency };
```

---

## 10. 实施计划

### Phase 1: 后端基础设施（2天）
- [x] 数据库连接池优化
- [ ] LLM 队列机制实现
- [ ] 环境配置分离
- [ ] 压力测试脚本

### Phase 2: 前端重构（3天）
- [ ] React + TypeScript 项目初始化
- [ ] 状态管理（Zustand）
- [ ] 核心组件开发
- [ ] 排队指示器 UI

### Phase 3: 测试与优化（2天）
- [ ] 单元测试覆盖
- [ ] 集成测试
- [ ] E2E 测试
- [ ] 性能优化

### Phase 4: 部署（1天）
- [ ] Docker 镜像构建
- [ ] 预发环境部署
- [ ] 生产环境部署
- [ ] 监控配置

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LLM API 限流 | 高 | 队列机制 + 指数退避重试 |
| 数据库连接耗尽 | 高 | 连接池 + 超时配置 |
| 前端性能问题 | 中 | 虚拟滚动 + 代码分割 |
| 安全漏洞 | 高 | JWT 认证 + 输入验证 + HTTPS |

---

**文档版本**: 1.0  
**最后更新**: 2026-06-22  
**作者**: AI Assistant

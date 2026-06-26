# AI Chat Assistant 技术设计文档

## 1. 项目概述

### 1.1 产品定位
企业级对话 AI 平台，提供可扩展的 AI 对话能力，支持高并发、Wiki 知识库检索、代码生成与预览、管理员完全控制。

### 1.2 目标用户
- **管理员**: 管理 LLM 模型配置、提示词模板、Wiki 知识库文档、用户权限
- **终端用户**: 与 AI 进行多轮对话，获取知识库支持的回答，生成前端页面并实时预览

### 1.3 核心功能
- 多轮对话管理（会话隔离、自动命名、上下文记忆）
- **LLM 意图分类 + 三路路由**（知识问答 / 页面生成 / 闲聊拒绝）
- **代码生成与动态预览**（Tool-call 循环 + 可点击预览链接）
- Wiki 知识库（DeepSeek tool-call agent 检索 markdown 文档）
- **多对话并行流式架构**（按 conversationId 隔离流式状态）
- LLM 模型动态配置（API 地址、密钥、参数）
- 提示词管理（创建、编辑、测试、激活）
- 高并发排队机制（LLM 请求限流）
- 用户认证与权限管理
- 文件日志系统（双输出 + 自动轮转）

---

## 2. 技术架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                              │
│  React 18 + TypeScript + Zustand + TanStack Query + AntD 5  │
│  ├─ streamStates (按 conversationId 隔离流式状态)             │
│  ├─ SSE 流式通信 (多对话并行，不因切换而中断)                  │
│  └─ CodePreview (可点击预览链接 + iframe)                     │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP + SSE
┌────────────────────────▼────────────────────────────────────┐
│                    Express.js Backend                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  LLM Workflow (POST /api/chat)                        │  │
│  │  Step 1: Intent Classification (LLM, 含对话上下文)     │  │
│  │  Step 2: Route Dispatch                               │  │
│  │    ├─ knowledge_qa → wiki_query + streamLLM           │  │
│  │    ├─ generate_page → tool-call 循环 + preview        │  │
│  │    └─ casual_chat → 拒绝                              │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌──────────────────┐  ┌──────────────────────────────────┐ │
│  │  LLM Queue       │  │  Code Generator (tool-call)      │ │
│  │  (内存 FIFO)     │  │  demo_code/{conversationId}/     │ │
│  │  并发控制 + 超时  │  │  6 tools: search/read/gen/...    │ │
│  └──────────────────┘  └──────────────────────────────────┘ │
└────────────┬───────────────────────┬────────────────────────┘
             │                       │
     ┌───────▼───────┐    ┌─────────▼────────────────────────┐
     │   MySQL 8.0   │    │  Python Wiki Agent (subprocess)  │
     │  users         │    │  wiki_query.py (DeepSeek agent) │
     │  conversations │    │  wiki_agent.py (整理 agent)      │
     │  messages      │    └─────────────────────────────────┘
     │  settings      │              │
     │  prompts       │    ┌─────────▼────────────────────────┐
     └───────────────┘    │  DeepSeek API (tool-call)         │
                          │  + 主 LLM API (流式 chat)          │
                          └────────────────────────────────────┘
```

### 2.2 技术栈选型

#### Frontend
- **React 18**: 并发特性
- **TypeScript**: 类型安全
- **Zustand**: 轻量状态管理（streamStates 按 conversationId 隔离）
- **TanStack Query (React Query)**: 服务端状态管理（消息列表缓存 + invalidate）
- **Ant Design 5**: 企业级 UI 组件库
- **Vite 6**: 快速构建工具
- **React Router v6**: 路由管理
- **dayjs**: 日期格式化

#### Backend
- **Node.js 18+ (ESM)**: 高性能运行时
- **Express.js**: Web 框架
- **mysql2/promise**: MySQL 连接池
- **JWT (jsonwebtoken)**: 身份认证
- **bcrypt**: 密码加密
- **Multer**: 文件上传
- **原生 fetch**: LLM API 调用（流式）

#### Python Agent
- **Python 3.8+**: Wiki agent 运行时
- **requests**: HTTP 调用
- **DeepSeek tool-call**: wiki_agent.py（整理） + wiki_query.py（检索）

#### Infrastructure
- **MySQL 8.0**: 关系型数据库（连接池）
- **文件系统**: Wiki 文档存储、代码预览文件
- **Docker**: 容器化部署
- **PM2**: 进程管理

---

## 3. LLM Workflow 架构

### 3.1 整体流程

```
用户消息 → LLM Queue 入队 → Intent Classification → Route Dispatch
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
            knowledge_qa      generate_page      casual_chat
            (知识问答)         (页面生成)          (闲聊拒绝)
```

### 3.2 Step 1: 意图分类 (Intent Classification)

使用 LLM 进行意图分类，**包含对话上下文**（最近 6 条历史消息）以支持多轮对话场景。

```javascript
// 意图分类 Prompt
const INTENT_CLASSIFICATION_PROMPT = `你是一个意图分类器。根据用户的对话上下文和最新消息，判断用户的意图：
1. "knowledge_qa" - 知识问答
2. "generate_page" - 生成/修改前端页面
3. "casual_chat" - 闲聊

注意：如果对话历史中包含页面生成任务，且用户最新消息是对之前生成内容的修改/追问，
应判定为 "generate_page"。

返回：{"intent": "knowledge_qa" 或 "generate_page" 或 "casual_chat"}`;

// 构建意图分类消息（包含上下文）
const recentHistory = truncatedMessages.slice(-6); // 最近 3 轮对话
const intentMessages = [
  { role: 'system', content: INTENT_CLASSIFICATION_PROMPT },
  ...recentHistory,
  { role: 'user', content: message }
];

// 非流式调用，temperature=0.1，max_tokens=50
const intentBody = {
  model: settings.llm_model,
  messages: intentMessages,
  stream: false,
  temperature: 0.1,
  max_tokens: 50
};
```

**设计要点**：
- 使用最近 6 条消息作为上下文（约 3 轮对话），确保多轮场景中准确识别修改页面的意图
- temperature=0.1 保证分类稳定性
- max_tokens=50 限制输出长度，加速分类
- 默认 fallback 为 `knowledge_qa`
- 分类结果通过 SSE 事件 `{ type: 'intent', intent }` 发送到前端

### 3.3 Step 2: 三路路由分发

#### Route A: knowledge_qa（知识问答）
```
1. searchKnowledge(message)
   └─ execSync(wiki_query.py) → DeepSeek tool-call 检索 wiki
2. knowledgeItems 注入 systemMessage
3. streamLLMCall(messages, includeTools=false)
   └─ 流式输出到 SSE
```

#### Route B: generate_page（页面生成）
```
1. systemMessage += CODE_GENERATION_PROMPT
2. 非流式 LLM 调用 (tools=toolDefinitions, tool_choice='auto')
3. Tool-call 循环（最多 10 次迭代）：
   ├─ 执行 tool_call → executeToolCall(toolCall, conversationId)
   ├─ 将结果追加到 messages
   ├─ SSE 事件: { type: 'tool_progress', tool, status }
   └─ 循环直到 finish_reason != 'tool_calls'
4. 最终文本响应 → 流式或直接输出
5. 动态预览 URL:
   └─ { type: 'preview', url: `/preview/${conversationId}/${lastGeneratedFile}` }
```

#### Route C: casual_chat（闲聊拒绝）
```
直接返回拒绝消息 + 功能引导文本
```

### 3.4 会话级别上下文记忆

```javascript
const MAX_HISTORY_MESSAGES = 20;  // 最大历史消息数
const MAX_CONTEXT_TOKENS = 8000;  // 最大上下文 token 数

// Token-aware 截断策略：
// 1. 限制最多 20 条消息
// 2. 从最新到最旧逆序添加，直到 token 预算耗尽
// 3. estimateTokenCount: Math.ceil(text.length / 3)
for (let i = historyMessages.length - 1; i >= 0; i--) {
  const msgTokens = estimateTokenCount(historyMessages[i].content);
  if (remainingTokens - msgTokens < 0 && truncatedMessages.length > 0) break;
  remainingTokens -= msgTokens;
  truncatedMessages.unshift(historyMessages[i]);
}
```

---

## 4. 代码生成与预览

### 4.1 Tool-call 循环

代码生成使用 OpenAI function calling 协议，定义 6 个工具：

| 工具 | 说明 |
|------|------|
| `search_codebase` | 搜索项目代码库中的代码片段 |
| `read_file` | 读取文件内容（支持行范围） |
| `get_project_structure` | 获取目录树结构 |
| `get_symbol_definition` | 查找符号定义 |
| `generate_code` | 生成/修改代码文件（create/append/insert/replace） |
| `run_command` | 执行安全命令（白名单限制） |

### 4.2 代码隔离

每个 conversation 独立目录：`demo_code/{conversationId}/`

```javascript
// tools/code-generator.js
export async function executeToolCall(toolCall, conversationId) {
  const baseDir = path.join(process.cwd(), 'demo_code', conversationId);
  await fs.mkdir(baseDir, { recursive: true });
  // safePath() 确保路径不会逃逸出 baseDir
}
```

### 4.3 动态预览 URL

```javascript
// 从 tool_call 参数提取实际文件名
if (toolCall.function.name === 'generate_code') {
  const args = JSON.parse(toolCall.function.arguments);
  if (args.file_path) lastGeneratedFile = args.file_path;
}

// 生成预览 URL
const previewUrl = `/preview/${conversationId}/${lastGeneratedFile}`;
res.write(`data: ${JSON.stringify({ type: 'preview', url: previewUrl })}\n\n`);
```

### 4.4 预览服务

```javascript
// 静态文件服务，设置安全头
app.use('/preview', express.static(path.join(__dirname, 'demo_code'), {
  setHeaders: (res) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  }
}));
```

### 4.5 前端 CodePreview 组件

```tsx
// 可点击的预览链接卡片 + iframe 预览
<CodePreview url={previewUrl} />
// - 显示完整 URL（可点击跳转）
// - "点击打开 ↗" / "新窗口打开" 按钮
// - iframe sandbox="allow-scripts allow-same-origin"
```

---

## 5. 多对话并行流式架构

### 5.1 核心设计

流式状态按 `conversationId` 隔离，支持多个对话同时进行 SSE 流：

```typescript
// stores/chatStore.ts
export interface ConversationStreamState {
  isStreaming: boolean;        // 该对话是否正在流式输出
  streamingContent: string;   // 该对话的流式内容缓冲
  toolProgress: { tool: string; status: string } | null;  // 工具执行进度
  previewUrl: string | null;  // 代码预览 URL
}

interface ChatState {
  streamStates: Record<number, ConversationStreamState>;
  // 所有流式操作都带 conversationId 参数
  setIsStreaming: (conversationId: number, streaming: boolean) => void;
  appendStreamingContent: (conversationId: number, chunk: string) => void;
  setToolProgress: (conversationId: number, progress: {...} | null) => void;
  setPreviewUrl: (conversationId: number, url: string | null) => void;
  finalizeStreaming: (conversationId: number) => void;
}
```

### 5.2 并行 SSE 关键机制

```typescript
// MessageInput.tsx - 发送消息时捕获 conversationId 快照
const handleSend = async () => {
  const convId = currentConversationId; // 快照

  setIsStreaming(convId, true);
  setStreamingContent(convId, '');

  await streamChat(convId, text, {
    onChunk: (content) => appendStreamingContent(convId, content),  // 写入快照 convId
    onDone: () => finalizeStreaming(convId),
    onToolProgress: (tool, status) => setToolProgress(convId, { tool, status }),
    onPreview: (url) => setPreviewUrl(convId, url),
  });
};
```

**关键特性**：
- 切换对话时不会中断后台 SSE 流（回调闭包绑定了 convId 快照）
- 每个对话独立维护 isStreaming、streamingContent、toolProgress、previewUrl
- MessageList 只渲染当前对话的 streamState
- finalizeStreaming 将 streamingContent 合并为 assistant message 写入 messages

### 5.3 SSE 通信协议

```typescript
// services/sse.ts - 事件类型
interface StreamCallbacks {
  onChunk: (content: string) => void;           // 文本 chunk
  onDone: () => void;                           // 流结束
  onError: (error: string) => void;             // 错误
  onQueueStatus?: (pending, active) => void;    // 队列状态
  onNotice?: (message: string) => void;         // RAG 降级通知
  onToolProgress?: (tool, status) => void;      // 工具执行进度
  onPreview?: (url: string) => void;            // 预览 URL
}
```

SSE 数据格式：
```
data: {"content": "..."}           // 文本 chunk
data: {"type": "queue", "pending": 2, "active": 3}
data: {"type": "intent", "intent": "generate_page"}
data: {"type": "notice", "message": "..."}
data: {"type": "tool_progress", "tool": "generate_code", "status": "running"}
data: {"type": "preview", "url": "/preview/1/index.html"}
data: {"error": "..."}
data: [DONE]
```

---

## 6. 文件日志系统

### 6.1 logger.js 实现

```javascript
// logger.js - 覆盖 console.log/error，实现双输出
const LOG_FILE = path.join(__dirname, 'app.log');
const MAX_SIZE = 10 * 1024 * 1024;  // 10MB 触发轮转
const KEEP_SIZE = 5 * 1024 * 1024;  // 保留最后 5MB

// 启动时检查：超过 10MB 则截断保留最后 5MB
if (stat.size > MAX_SIZE) {
  // 读取最后 5MB → 覆盖写入
}

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

// 覆盖 console.log → 同时输出到终端和文件
console.log = (...args) => {
  originalLog(...args);                          // 终端输出
  logStream.write(`[${timestamp()}] [INFO] ${msg}\n`);  // 文件输出
};

// 覆盖 console.error → 同上，标记 [ERROR]
console.error = (...args) => {
  originalError(...args);
  logStream.write(`[${timestamp()}] [ERROR] ${msg}\n`);
};
```

### 6.2 日志格式

```
[2026-06-26 14:30:25] [INFO] [chat] intent: generate_page | message: "帮我生成一个 TodoList"
[2026-06-26 14:30:25] [ERROR] LLM API error: 429
```

### 6.3 加载时机

```javascript
// server.js 首行导入，确保所有后续 console 输出都被拦截
import './logger.js';
```

---

## 7. LLM 请求队列

### 7.1 设计目标
- 限制并发 LLM 请求数（防止 API 限流）
- FIFO 公平排队
- 用户可见的排队状态反馈
- 超时自动取消

### 7.2 实现（queue/llm-queue.js）

```javascript
class LLMQueue extends EventEmitter {
  constructor(options = {}) {
    this.queue = [];
    this.activeRequests = 0;
    this.maxConcurrent = options.maxConcurrent || process.env.LLM_MAX_CONCURRENT || 5;
    this.timeoutMs = options.timeoutMs || process.env.LLM_REQUEST_TIMEOUT || 60000;
  }

  async enqueue(request, executeFn) {
    // 1. 创建 queueItem，push 到 queue
    // 2. 设置超时定时器
    // 3. 触发 _processQueue()
    return new Promise((resolve, reject) => { ... });
  }

  _processQueue() {
    // activeRequests < maxConcurrent 时，从队头取出执行
    while (this.activeRequests < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift();
      this.activeRequests++;
      this._executeRequest(item);
    }
  }

  getStatus() {
    return {
      pending: this.queue.length,
      active: this.activeRequests,
      maxConcurrent: this.maxConcurrent,
      estimatedWaitTime: this.queue.length * 5000  // 每请求约 5 秒
    };
  }
}

export default new LLMQueue();  // 全局单例
```

### 7.3 队列事件

| 事件 | 触发时机 |
|------|----------|
| `enqueued` | 请求入队 |
| `processing` | 开始执行 |
| `completed` | 执行完成 |
| `failed` | 执行失败 |
| `timeout` | 队列超时 |
| `status` | 状态变更 |

### 7.4 前端排队提示

当 `queueStatus.pending > 0` 时，后端 SSE 发送队列事件：
```javascript
res.write(`data: ${JSON.stringify({ type: 'queue', ...queueStatus })}\n\n`);
```

前端通过 `onQueueStatus` 回调接收并展示。

---

## 8. 数据库设计

### 8.1 核心表结构

#### users（用户表）
```sql
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'user') DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

---

## 9. 服务启动流程

### 9.1 server.js 启动序列

```
1. import './logger.js'           → 覆盖 console，启用文件日志
2. dotenv.config()                → 加载 .env（按 __dirname 定位）
3. 检测 frontend/dist             → 不存在则自动 npm install + build
4. import app from './app.js'     → 加载 Express 应用
5. ensureAdminUser()              → 确保默认管理员账户存在
6. app.listen(PORT)               → 启动 HTTP 服务
```

### 9.2 环境配置

```bash
# .env 核心变量
PORT=3000
DB_HOST / DB_USER / DB_PASSWORD / DB_NAME
JWT_SECRET
DEEPSEEK_API_KEY          # Wiki agent 专用
LLM_MAX_CONCURRENT=5     # 队列最大并发
LLM_REQUEST_TIMEOUT=60000
```

---

## 10. 前端架构

### 10.1 项目结构

```
frontend/src/
├── components/
│   ├── chat/
│   │   ├── MessageList.tsx      # 消息列表（读取当前对话 streamState）
│   │   ├── MessageInput.tsx     # 输入组件（发送 + 多对话并行支持）
│   │   ├── CodePreview.tsx      # 代码预览（可点击链接 + iframe）
│   │   ├── ToolProgress.tsx     # 工具执行进度指示器
│   │   ├── ConversationSidebar.tsx
│   │   └── QueueIndicator.tsx
│   ├── admin/
│   │   ├── KnowledgeManagement.tsx
│   │   ├── LLMSettings.tsx
│   │   ├── PromptManagement.tsx
│   │   └── UserManagement.tsx
│   ├── ProtectedRoute.tsx
│   └── AdminRoute.tsx
├── pages/
│   ├── ChatPage.tsx
│   ├── LoginPage.tsx
│   └── AdminPage.tsx
├── stores/
│   ├── chatStore.ts            # 核心：streamStates 按 conversationId 隔离
│   └── authStore.ts
├── services/
│   ├── api.ts                  # REST API 调用
│   └── sse.ts                  # SSE 流式通信
├── hooks/
│   ├── useConversations.ts     # TanStack Query hooks
│   └── useAdminData.ts
├── types/
│   └── index.ts
└── styles/
    └── global.css
```

### 10.2 状态管理

- **Zustand chatStore**: 流式状态（streamStates）、当前对话 ID、消息列表
- **TanStack Query**: 服务端数据（对话列表、消息列表），自动缓存 + invalidate
- **authStore**: JWT token、用户信息

---

## 11. 部署与监控

### 11.1 Docker 部署

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### 11.2 进程管理
- PM2 管理 Node.js 进程
- `restart.sh`: git pull → npm install → frontend build → pm2 restart

### 11.3 日志
- 文件日志: `app.log`（自动 10MB 轮转）
- PM2 日志: `pm2 logs llm_test`
- 结构化前缀: `[chat]`, `[classifyQuery]`, `[searchKnowledge]`

---

## 12. 安全性

| 层面 | 措施 |
|------|------|
| 认证 | JWT + bcrypt hash (salt: 10) |
| 授权 | requireAdmin 中间件 + user_id 数据隔离 |
| 文件上传 | 10MB 限制 + 文件名 latin1→utf8 修复 |
| SQL 注入 | mysql2 参数化查询 |
| 代码生成 | safePath() 防止路径遍历，run_command 白名单 |
| 预览安全 | X-Frame-Options + CSP frame-ancestors |
| 跨域 | CORS（生产环境应限制 origin） |

---

**文档版本**: 2.0  
**最后更新**: 2026-06-26  
**作者**: AI Assistant
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

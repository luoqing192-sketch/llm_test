# LLM Test - 技术架构文档

> 版本：3.0  
> 最后更新：2026-06-26  
> 作者：qing + AI Assistant

## 目录

1. [系统概览](#系统概览)
2. [技术栈](#技术栈)
3. [架构设计](#架构设计)
4. [LLM Workflow 架构](#llm-workflow-架构)
5. [多对话并行流式架构](#多对话并行流式架构)
6. [代码生成与预览](#代码生成与预览)
7. [文件日志系统](#文件日志系统)
8. [LLM 请求队列](#llm-请求队列)
9. [核心模块](#核心模块)
10. [数据流](#数据流)
11. [部署架构](#部署架构)
12. [关键设计决策](#关键设计决策)
13. [安全性](#安全性)

---

## 系统概览

**LLM Test** 是一个多 LLM 集成的智能对话系统，支持：
- 多用户、多会话管理
- **LLM 意图分类 + 三路路由**（知识问答 / 代码生成 / 闲聊拒绝）
- **代码生成与动态预览**（Tool-call 循环 + 可点击预览链接）
- **多对话并行流式输出**（按 conversationId 隔离，切换不中断）
- Wiki 知识库（基于 DeepSeek tool-call agent）
- 动态 LLM 配置（OpenAI/DeepSeek/Anthropic 等）
- Prompt 模板管理
- 管理后台（用户/设置/Prompt/Wiki）
- 文件日志系统（双输出 + 10MB 自动轮转）

### 核心特性

| 特性 | 说明 |
|------|------|
| **意图分类路由** | LLM 对用户消息分类 → 三路分发（含对话上下文） |
| **多模型支持** | 兼容 OpenAI、Anthropic、DeepSeek 等主流 API |
| **代码生成** | Tool-call 循环（6 工具）+ 动态预览 URL + iframe |
| **多对话并行** | streamStates 按 conversationId 隔离，SSE 流互不干扰 |
| **Wiki 知识库** | tool-call agent 自动检索、整理 markdown 文档 |
| **流式对话** | SSE 实时流式输出 + 多种事件类型 |
| **上下文记忆** | Token-aware 截断 + 最多 20 条历史消息 |
| **用户隔离** | conversation/message 按 user_id 完全隔离 |
| **文件日志** | console 覆盖，双输出终端 + app.log，10MB 轮转 |
| **管理后台** | 完整的 admin 权限控制 |

---

## 技术栈

### 后端
- **运行时**: Node.js 18+ (ESM)
- **框架**: Express.js
- **数据库**: MySQL 8.0 (mysql2/promise 连接池)
- **认证**: JWT (jsonwebtoken)
- **加密**: bcrypt (salt rounds: 10)
- **文件上传**: multer (10MB 限制)
- **LLM 调用**: 原生 fetch (流式)
- **脚本执行**: child_process (Python wiki agent)
- **日志**: logger.js (console 覆盖 + 文件写入)

### 前端
- **框架**: React 18 + TypeScript
- **构建**: Vite 6
- **UI 库**: Ant Design 5
- **路由**: React Router 6
- **状态管理**:
  - Zustand (chatStore: 流式状态隔离)
  - TanStack Query (server state 缓存)
- **HTTP**: 原生 fetch (SSE 流式)
- **日期**: dayjs

### Python Agent
- **运行时**: Python 3.8+
- **依赖**: requests
- **功能**: Wiki 文档整理（wiki_agent.py）+ 检索（wiki_query.py）
- **LLM**: DeepSeek deepseek-v4-pro (tool-call)

---

## 架构设计

```
┌──────────────────────────────────────────────────────────────────────┐
│                            Browser                                     │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  React SPA (Vite)                                              │  │
│  │  ├─ Chat UI (SSE streaming, 多对话并行)                         │  │
│  │  │   ├─ streamStates: Record<conversationId, StreamState>      │  │
│  │  │   ├─ MessageInput → streamChat(convId, ...)                 │  │
│  │  │   ├─ MessageList → 读取当前对话 streamState                  │  │
│  │  │   └─ CodePreview → 可点击预览链接 + iframe                   │  │
│  │  ├─ Admin Panel (users/settings/wiki/prompts)                  │  │
│  │  └─ Auth (JWT in localStorage)                                 │  │
│  └────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ HTTP + SSE (fetch)
                                 ↓
┌──────────────────────────────────────────────────────────────────────┐
│                       Express.js Backend                               │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  POST /api/chat (SSE)                                          │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │  LLM Workflow                                            │  │  │
│  │  │  Step 1: Intent Classification (LLM, 含最近6条上下文)     │  │  │
│  │  │  Step 2: Route Dispatch                                  │  │  │
│  │  │    ├─ knowledge_qa → wiki_query.py + streamLLM           │  │  │
│  │  │    ├─ generate_page → tool-call 循环 + preview URL       │  │  │
│  │  │    └─ casual_chat → 拒绝消息                              │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────┐  ┌──────────────────────────────────────┐  │
│  │  LLM Queue           │  │  Code Generator (tools/)             │  │
│  │  ├─ FIFO 队列        │  │  ├─ 6 tools (OpenAI func calling)   │  │
│  │  ├─ 并发上限 5       │  │  ├─ demo_code/{convId}/ 隔离        │  │
│  │  └─ 60s 超时         │  │  └─ safePath() 路径安全             │  │
│  └──────────────────────┘  └──────────────────────────────────────┘  │
│  ┌──────────────────────┐  ┌──────────────────────────────────────┐  │
│  │  logger.js           │  │  /preview 静态文件服务               │  │
│  │  ├─ console 覆盖     │  │  └─ demo_code/ + CSP headers        │  │
│  │  ├─ 终端 + app.log   │  └──────────────────────────────────────┘  │
│  │  └─ 10MB 轮转        │                                           │
│  └──────────────────────┘                                            │
└──────────┬──────────────────────────────┬────────────────────────────┘
           │                              │
   ┌───────▼───────────┐    ┌────────────▼───────────────────────────┐
   │   MySQL 8.0       │    │  Python Wiki Agent (subprocess)        │
   │  ├─ users         │    │  ├─ wiki_query.py (read-only, 检索)   │
   │  ├─ conversations │    │  └─ wiki_agent.py (read-write, 整理)  │
   │  ├─ messages      │    └────────────────┬───────────────────────┘
   │  ├─ settings      │                     │
   │  └─ prompts       │    ┌────────────────▼───────────────────────┐
   └───────────────────┘    │  DeepSeek API (tool-call)              │
                            │  model: deepseek-v4-pro                 │
                            │  endpoint: api.deepseek.com             │
                            └─────────────────────────────────────────┘
```

---

## LLM Workflow 架构

### 整体流程

```
POST /api/chat { conversationId, message }
  │
  ├─ 1. 保存用户消息到 DB
  ├─ 2. 加载对话历史 → Token-aware 截断
  ├─ 3. LLM Queue 入队（并发控制）
  │
  ├─ 4. ════ Step 1: Intent Classification ════
  │     ├─ 构建 intentMessages:
  │     │   [system: 分类Prompt, ...recentHistory(最近6条), user: message]
  │     ├─ 非流式 LLM 调用 (temperature=0.1, max_tokens=50)
  │     ├─ 解析结果: {"intent": "knowledge_qa"|"generate_page"|"casual_chat"}
  │     └─ SSE 发送: { type: 'intent', intent }
  │
  ├─ 5. ════ Step 2: Route Dispatch ════
  │     │
  │     ├─ [knowledge_qa] 知识问答
  │     │   ├─ searchKnowledge(message)
  │     │   │   └─ execSync(wiki_query.py) → DeepSeek tool-call 检索
  │     │   ├─ knowledgeItems 注入 systemMessage
  │     │   ├─ (可选) RAG 降级通知: { type: 'notice', message }
  │     │   └─ streamLLMCall(messages, tools=false) → SSE 流式输出
  │     │
  │     ├─ [generate_page] 页面生成
  │     │   ├─ systemMessage += CODE_GENERATION_PROMPT
  │     │   ├─ 非流式 LLM 调用 (tools=toolDefinitions)
  │     │   ├─ Tool-call 循环 (最多 10 次迭代):
  │     │   │   ├─ executeToolCall(toolCall, conversationId)
  │     │   │   ├─ SSE: { type: 'tool_progress', tool, status }
  │     │   │   └─ 追加 tool result → 再次调用 LLM
  │     │   ├─ 最终文本回复 → 流式或直接输出
  │     │   └─ SSE: { type: 'preview', url: '/preview/{convId}/{file}' }
  │     │
  │     └─ [casual_chat] 闲聊拒绝
  │         └─ 直接返回拒绝文本 + 功能引导
  │
  ├─ 6. 保存 assistant 回复到 DB
  ├─ 7. 首次对话自动生成标题
  └─ 8. SSE: data: [DONE]
```

### 意图分类设计要点

- **包含对话上下文**：使用最近 6 条消息（约 3 轮对话），确保多轮场景准确分类
- **低温度**：temperature=0.1 保证分类稳定
- **快速响应**：max_tokens=50，只输出一个 JSON
- **多轮追问识别**：如果历史中有页面生成，后续修改追问应归类为 `generate_page`
- **默认 fallback**：分类失败时默认为 `knowledge_qa`

### 会话上下文管理

```javascript
const MAX_HISTORY_MESSAGES = 20;  // 硬限制：最多 20 条
const MAX_CONTEXT_TOKENS = 8000;  // 软限制：Token 预算

// Token-aware 截断策略（从最新到最旧）
for (let i = historyMessages.length - 1; i >= 0; i--) {
  const msgTokens = estimateTokenCount(historyMessages[i].content);
  if (remainingTokens - msgTokens < 0 && truncatedMessages.length > 0) break;
  remainingTokens -= msgTokens;
  truncatedMessages.unshift(historyMessages[i]);
}

// Token 估算：Math.ceil(text.length / 3)
```

---

## 多对话并行流式架构

### 核心设计原理

传统方案中切换对话会中断当前 SSE 流。本系统通过 **conversationId 隔离** 实现真正的多对话并行：

```typescript
// chatStore.ts 核心数据结构
streamStates: Record<number, ConversationStreamState>

interface ConversationStreamState {
  isStreaming: boolean;        // 该对话是否在流式输出
  streamingContent: string;   // 流式内容缓冲
  toolProgress: { tool: string; status: string } | null;
  previewUrl: string | null;
}
```

### 关键实现机制

#### 1. 发送时捕获 conversationId 快照

```typescript
// MessageInput.tsx
const handleSend = async () => {
  const convId = currentConversationId; // ← 快照，闭包捕获
  setIsStreaming(convId, true);

  await streamChat(convId, text, {
    onChunk: (content) => appendStreamingContent(convId, content),
    onDone: () => finalizeStreaming(convId),
    onToolProgress: (tool, status) => setToolProgress(convId, { tool, status }),
    onPreview: (url) => setPreviewUrl(convId, url),
  });
};
```

#### 2. MessageList 只读当前对话状态

```typescript
// MessageList.tsx
const streamState = useChatStore((s) =>
  s.currentConversationId
    ? (s.streamStates[s.currentConversationId] || defaultStreamState)
    : defaultStreamState
);
const { isStreaming, streamingContent, toolProgress, previewUrl } = streamState;
```

#### 3. 切换对话不影响后台流

- SSE 连接绑定的回调使用闭包中的 `convId` 写入对应 streamState
- 切换对话只是改变 `currentConversationId`，UI 读取不同的 streamState
- 后台流继续运行，`finalizeStreaming(convId)` 最终将内容合并

#### 4. finalizeStreaming 智能合并

```typescript
finalizeStreaming: (conversationId) => {
  const streamState = get().streamStates[conversationId];
  if (streamState.streamingContent && conversationId) {
    const assistantMessage = { ... };
    set((state) => ({
      // 只有当前对话才追加到 messages
      messages: conversationId === state.currentConversationId
        ? [...state.messages, assistantMessage]
        : state.messages,
      streamStates: { ...reset streamState... }
    }));
  }
}
```

---

## 代码生成与预览

### Tool-call 循环机制

```
LLM 收到用户生成页面请求
  ↓
返回 tool_calls: [{ function: "generate_code", arguments: {...} }]
  ↓
executeToolCall(toolCall, conversationId)
  ├─ baseDir = demo_code/{conversationId}/
  ├─ safePath() 安全检查
  └─ 执行工具 → 返回结果
  ↓
将 tool result 追加到 messages → 再次调用 LLM
  ↓
循环直到 finish_reason != 'tool_calls' (最多 10 次)
  ↓
发送 preview URL
```

### 6 个工具定义

| 工具 | 功能 | 安全措施 |
|------|------|----------|
| `search_codebase` | 搜索代码片段 | 限定 baseDir |
| `read_file` | 读取文件（支持行范围） | safePath 路径检查 |
| `get_project_structure` | 目录树结构 | 限定深度 |
| `get_symbol_definition` | 查找符号定义 | 限定 JS/TS 文件 |
| `generate_code` | 生成/修改文件（4种模式） | safePath + 自动建目录 |
| `run_command` | 执行命令 | 白名单 + 30s 超时 |

### 动态预览 URL

```javascript
// 从 tool_call arguments 提取实际文件名
if (toolCall.function.name === 'generate_code') {
  const args = JSON.parse(toolCall.function.arguments);
  if (args.file_path) lastGeneratedFile = args.file_path;
}

// 最终 URL: /preview/{conversationId}/{lastGeneratedFile}
// 例如: /preview/42/index.html
```

### 前端预览组件

```
CodePreview 组件:
├─ 可点击预览链接（完整 URL 展示 + "点击打开 ↗"）
├─ "新窗口打开" 按钮
└─ iframe (sandbox="allow-scripts allow-same-origin", height: 400px)
```

### 安全隔离

- 每个 conversation 独立目录 `demo_code/{conversationId}/`
- `safePath()` 防止路径遍历攻击
- `run_command` 仅允许白名单命令: ls, cat, find, node, npm, npx, echo, mkdir
- 预览服务设置 `X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'`

---

## 文件日志系统

### logger.js 设计

```
┌─────────────────────────────────────────────────┐
│  server.js (首行)                                │
│  import './logger.js'                           │
│    ↓                                            │
│  覆盖 console.log / console.error               │
│    ├─ 原始函数 → 终端输出（保持颜色/emoji）      │
│    └─ logStream → app.log 文件写入              │
│                                                  │
│  日志格式:                                       │
│  [2026-06-26 14:30:25] [INFO] message...        │
│  [2026-06-26 14:30:25] [ERROR] error message... │
└─────────────────────────────────────────────────┘
```

### 自动轮转

```javascript
const MAX_SIZE = 10 * 1024 * 1024;  // 10MB 触发
const KEEP_SIZE = 5 * 1024 * 1024;  // 保留最后 5MB

// 启动时检查：
// 如果 app.log > 10MB → 读取最后 5MB → 覆盖写入
// 运行时：追加写入模式 (flags: 'a')
```

### 日志标签

| 标签 | 来源 |
|------|------|
| `[chat]` | 聊天请求处理 |
| `[classifyQuery]` | 意图分类 |
| `[searchKnowledge]` | Wiki 检索 |
| `[wiki upload]` | Wiki 文件上传 |
| `[wiki organize]` | Wiki 整理 |

---

## LLM 请求队列

### queue/llm-queue.js

```javascript
class LLMQueue extends EventEmitter {
  queue = [];                // FIFO 队列
  activeRequests = 0;        // 当前活跃请求数
  maxConcurrent = 5;         // 最大并发数（env: LLM_MAX_CONCURRENT）
  timeoutMs = 60000;         // 超时时间（env: LLM_REQUEST_TIMEOUT）

  enqueue(request, executeFn) → Promise
  // 1. 入队 → 2. 设超时 → 3. processQueue()

  _processQueue()
  // activeRequests < maxConcurrent 时从队头取出执行

  _executeRequest(item)
  // try { executeFn() → resolve } catch { reject } finally { activeRequests-- → processQueue() }

  getStatus() → { pending, active, maxConcurrent, estimatedWaitTime }
}

// 全局单例
export default new LLMQueue();
```

### 前端集成

```
1. 后端 SSE 发送: { type: 'queue', pending: N, active: M }
2. 前端 onQueueStatus 回调 → setQueueStatus(pending, active)
3. QueueIndicator 组件显示排队状态
```

---

## 核心模块

### 1. 认证系统

```
POST /api/auth/login → bcrypt verify → JWT sign → { token, user }
前端: localStorage('token') → Authorization: Bearer <token>
中间件: authenticateToken → req.user = { id, username, role }
管理员: requireAdmin → role === 'admin'
```

### 2. Wiki 知识库

#### 架构
```
wiki/
├── script/
│   ├── wiki_agent.py    # 整理 agent（可读写）
│   └── wiki_query.py    # 查询 agent（只读）
├── *.md                 # Wiki 文档
└── INDEX.md             # wiki_agent 自动生成的索引
```

#### wiki_query.py 检索流程
```
searchKnowledge(query)
  ↓
execSync(`python3 wiki_query.py "${query}"`)
  ↓
Python 调用 DeepSeek tool-call:
  1. list_files() → 列出 wiki 文件
  2. search_content(keyword) → 搜索匹配
  3. read_file(path) → 读取内容
  4. LLM 总结 → 返回答案 + 引用
  ↓
Node.js 解析输出（═ 分隔线之间的答案）
  ↓
返回 { items: [{ title, content, knowledge_base_name }] }
```

#### 管理 API
- `GET /api/admin/wiki` — 列出 wiki 文件
- `POST /api/admin/wiki/upload` — 上传 .md 文件
- `DELETE /api/admin/wiki/:filename` — 删除文件
- `POST /api/admin/wiki/organize` — 调用 wiki_agent 整理
- `POST /api/admin/wiki/query` — 手动查询

### 3. LLM 配置管理

| settings Key | 说明 |
|-------------|------|
| `llm_base_url` | API 完整端点 URL (如 `https://api.openai.com/v1/chat/completions`) |
| `llm_model` | 模型名 |
| `llm_api_key` | API Key |
| `llm_temperature` | 温度 (默认 0.7) |
| `llm_max_tokens` | 最大 tokens (默认 4096) |
| `llm_top_p` | Top-P (默认 0.9) |

### 4. Prompt 模板

- 同时只能激活一个 prompt
- 聊天时 `getActivePrompt()` 读取当前激活模板作为 system message
- 代码生成路由会追加 `CODE_GENERATION_PROMPT`

### 5. 用户隔离

```sql
-- 所有查询带 user_id 过滤
SELECT * FROM conversations WHERE id = ? AND user_id = ?
-- 删除级联
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
```

---

## 数据流

### 完整聊天数据流（generate_page 示例）

```
用户输入 "帮我做一个 TodoList 页面"
  ↓
1. POST /api/chat { conversationId: 42, message: "帮我做一个 TodoList 页面" }
  ↓
2. authenticateToken → req.user
  ↓
3. 验证 conversation 归属 + 保存 user message
  ↓
4. 加载历史 → Token-aware 截断（最多 20 条，8000 tokens）
  ↓
5. LLM Queue 入队
   └─ (如有排队) SSE: { type: 'queue', pending: 2, active: 5 }
  ↓
6. Intent Classification:
   intentMessages = [classifyPrompt, ...last6Messages, userMsg]
   LLM 返回: {"intent": "generate_page"}
   SSE: { type: 'intent', intent: 'generate_page' }
  ↓
7. Route: generate_page
   ├─ systemMessage = activePrompt + CODE_GENERATION_PROMPT
   ├─ 非流式 LLM 调用 (tools=6个工具)
   ├─ LLM 返回 tool_calls: [generate_code({file_path: "index.html", ...})]
   │
   ├─ Tool-call 循环:
   │   ├─ SSE: { type: 'tool_progress', tool: 'generate_code', status: 'running' }
   │   ├─ executeToolCall → 写入 demo_code/42/index.html
   │   ├─ SSE: { type: 'tool_progress', tool: 'generate_code', status: 'completed' }
   │   └─ 再次调用 LLM → (可能继续 tool_calls 或返回文本)
   │
   ├─ 最终文本: "我已经为你创建了一个 TodoList 页面..."
   │   SSE: { content: "我已经..." }
   │
   └─ 预览链接:
       SSE: { type: 'preview', url: '/preview/42/index.html' }
  ↓
8. 保存 assistant 回复 → 更新 conversation.updated_at
  ↓
9. SSE: data: [DONE]
```

### 前端接收流程

```
streamChat(convId=42, text, callbacks)
  ↓
fetch('/api/chat', { body: { conversationId: 42, message } })
  ↓
reader.read() loop:
  ├─ { type: 'queue' }        → onQueueStatus(pending, active)
  ├─ { type: 'intent' }       → (信息性，不做处理)
  ├─ { type: 'tool_progress' } → onToolProgress → setToolProgress(42, {...})
  ├─ { content: "..." }       → onChunk → appendStreamingContent(42, chunk)
  ├─ { type: 'preview' }      → onPreview → setPreviewUrl(42, url)
  ├─ { error: "..." }         → onError
  └─ [DONE]                   → onDone → finalizeStreaming(42) + invalidateQueries
```

---

## 部署架构

### 目录结构
```
/root/llm_test/
├── server.js              # 入口（logger + env + auto-build + start）
├── app.js                 # Express 应用（路由 + LLM workflow）
├── logger.js              # 日志模块（console 覆盖 + 文件）
├── db.js                  # MySQL 连接池
├── auth.js                # JWT 中间件
├── init-admin.js          # 默认管理员初始化
├── queue/
│   └── llm-queue.js       # LLM 请求队列
├── tools/
│   └── code-generator.js  # 6 个代码生成工具
├── wiki/
│   ├── script/
│   │   ├── wiki_agent.py
│   │   └── wiki_query.py
│   └── *.md
├── demo_code/             # 代码预览文件（按 conversationId 隔离）
│   ├── 1/
│   └── 2/
├── frontend/
│   ├── src/
│   └── dist/              # 前端构建产物
├── .env                   # 环境变量
├── app.log                # 应用日志（自动轮转）
└── restart.sh             # 部署脚本
```

### 启动流程

```bash
node server.js
  ↓
1. import './logger.js'        # 初始化日志（检查轮转 + 覆盖 console）
2. dotenv.config()             # 加载 .env（按 __dirname 定位）
3. 检测 frontend/dist          # 不存在则自动构建
4. import app from './app.js'  # 加载 Express 应用
5. ensureAdminUser()           # 确保默认 admin 存在
6. app.listen(PORT)            # 启动 HTTP (默认 3000)
```

### 环境变量

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=llm_test
JWT_SECRET=your_jwt_secret
DEEPSEEK_API_KEY=sk-xxx       # Wiki agent 专用
LLM_MAX_CONCURRENT=5          # 队列并发上限
LLM_REQUEST_TIMEOUT=60000     # 队列超时(ms)
```

### 进程管理
- **PM2**: 自动重启、日志管理
- **restart.sh**: git pull → npm install → frontend build → pm2 restart

---

## 关键设计决策

### 1. 为什么用 LLM 做意图分类而不是规则匹配？

**优势**：
- 能理解自然语言的细微差异（"改一下颜色" vs "什么是颜色"）
- 包含对话上下文后能正确识别多轮修改意图
- 无需维护关键词列表

**成本**：
- 每次请求多一次 LLM 调用（温度 0.1, 50 tokens 快速返回）
- 失败时 fallback 到 knowledge_qa

### 2. 为什么用 Python subprocess 调用 wiki agent？

**优势**：
- wiki_agent/wiki_query 是独立脚本，可单独测试/维护
- DeepSeek tool-call 实现复杂，Python 代码更清晰
- Node.js 调用简单（execSync），环境变量隔离

### 3. 为什么流式状态按 conversationId 隔离？

**问题**：传统全局 isStreaming 状态，切换对话时必须中断流或禁止切换。

**解决方案**：`streamStates: Record<number, ConversationStreamState>`
- 每个对话独立状态，切换只是读取不同 key
- SSE 回调闭包捕获 convId，写入正确的状态槽
- 用户可同时发起多个对话的 LLM 请求

### 4. 为什么 multer 文件名要从 latin1 转 utf8？

**问题**：HTTP `Content-Disposition` header 默认 latin1，中文文件名乱码。
```javascript
const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
```

### 5. 为什么用 `__dirname` 而不是 `process.cwd()`？

**问题**：`restart.sh` 中 `cd frontend && npm run build` 会改变 cwd。
```javascript
const uploadsDir = path.join(__dirname, 'uploads'); // 绝对可靠
```

---

## 安全性

### 1. 认证
- JWT token 有效期：30d（可配置 JWT_EXPIRES_IN）
- 密码 bcrypt hash（salt rounds: 10）
- token 存 localStorage

### 2. 授权
- 所有 admin API 需 `requireAdmin` 中间件
- conversation/message 查询都带 `user_id` 过滤

### 3. 文件上传
- 限制文件大小：10MB
- Wiki upload 只接受 `.md` 文件
- 文件名 latin1→utf8 编码修复

### 4. 代码生成安全
- `safePath()`: 解析路径后检查是否在 baseDir 内
- `run_command`: 白名单限制（ls, cat, find, node, npm, npx, echo, mkdir）
- 30s 命令执行超时

### 5. 预览安全
- `X-Frame-Options: SAMEORIGIN`
- `Content-Security-Policy: frame-ancestors 'self'`
- iframe `sandbox="allow-scripts allow-same-origin"`

### 6. SQL 注入
- 所有查询用 mysql2 参数化（prepared statements）

### 7. 跨域
- CORS 允许所有来源（开发环境）
- 生产环境应限制 `origin`

---

## 性能优化

### 1. 数据库
- conversation/message 表按 `user_id` 和 `conversation_id` 索引
- 聊天历史限制最近 20 条（MAX_HISTORY_MESSAGES）
- Token-aware 截断（MAX_CONTEXT_TOKENS = 8000）

### 2. 前端
- TanStack Query 缓存 + invalidate
- Zustand selector 精确订阅（避免不必要渲染）
- streamStates 隔离避免跨对话状态污染

### 3. 流式输出
- SSE 流式传输，降低首字延迟
- 前端逐 chunk 追加渲染

### 4. LLM 队列
- 并发控制防止 API 限流
- 超时自动清理，避免队列堆积

---

## 未来优化方向

1. **向量数据库**：Qdrant/Milvus 替代 wiki_query.py（更快的语义检索）
2. **缓存层**：Redis 缓存 LLM 响应、wiki 检索结果
3. **意图分类缓存**：相似消息复用分类结果
4. **多租户**：organization 表，隔离不同团队的 wiki
5. **wiki 版本控制**：Git 管理 wiki/ 目录
6. **异步任务队列**：Bull/BullMQ 处理 wiki_agent 长任务
7. **前端离线支持**：Service Worker + IndexedDB
8. **Markdown 渲染**：消息支持 markdown 格式化显示

---

**文档维护**：每次重大架构变更后更新此文档。
# LLM Test - 技术架构文档

> 版本：2.0  
> 最后更新：2026-06-24  
> 作者：qing + Claude Opus 4.6

## 目录

1. [系统概览](#系统概览)
2. [技术栈](#技术栈)
3. [架构设计](#架构设计)
4. [核心模块](#核心模块)
5. [数据流](#数据流)
6. [部署架构](#部署架构)
7. [关键设计决策](#关键设计决策)
8. [安全性](#安全性)

---

## 系统概览

**LLM Test** 是一个多 LLM 集成的智能对话系统，支持：
- 多用户、多会话管理
- 动态 LLM 配置（OpenAI/DeepSeek/Anthropic 等）
- **Wiki 知识库**（基于 DeepSeek tool-call agent）
- Prompt 模板管理
- 管理后台（用户/设置/Prompt/Wiki）

### 核心特性

| 特性 | 说明 |
|------|------|
| **多模型支持** | 兼容 OpenAI、Anthropic、DeepSeek 等主流 API |
| **Wiki 知识库** | tool-call agent 自动检索、整理 markdown 文档 |
| **流式对话** | SSE 实时流式输出 |
| **用户隔离** | conversation/message 按 user_id 完全隔离 |
| **管理后台** | 完整的 admin 权限控制 |

---

## 技术栈

### 后端
- **运行时**: Node.js 18+ (ESM)
- **框架**: Express.js
- **数据库**: MySQL 8.0 (mysql2/promise)
- **认证**: JWT (jsonwebtoken)
- **文件上传**: multer
- **加密**: bcryptjs
- **脚本执行**: child_process (Python wiki agent)

### 前端
- **框架**: React 18 + TypeScript
- **构建**: Vite 6
- **UI 库**: Ant Design 5
- **路由**: React Router 6
- **状态管理**: 
  - Zustand (auth/chat store)
  - TanStack Query (server state)
- **HTTP**: Axios

### Python Agent
- **运行时**: Python 3.8+
- **依赖**: requests
- **功能**: Wiki 文档整理（wiki_agent.py）+ 检索（wiki_query.py）

---

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  React SPA (Vite)                                    │   │
│  │  ├─ Chat UI (streaming SSE)                          │   │
│  │  ├─ Admin Panel (users/settings/wiki/prompts)       │   │
│  │  └─ Auth (JWT in localStorage)                      │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS (axios)
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                     Express.js Backend                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  API Routes                                          │   │
│  │  ├─ /api/auth (login/register)                      │   │
│  │  ├─ /api/chat (SSE streaming)                       │   │
│  │  ├─ /api/conversations (CRUD)                       │   │
│  │  ├─ /api/admin/wiki (list/upload/delete/organize)  │   │
│  │  ├─ /api/admin/settings (LLM config)               │   │
│  │  └─ /api/admin/prompts (template CRUD)             │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Core Services                                       │   │
│  │  ├─ classifyQuery (keyword n-gram matching)        │   │
│  │  ├─ searchKnowledge (call wiki_query.py)           │   │
│  │  └─ LLM streaming (fetch + SSE)                    │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────┬──────────────────────┬──────────────────────────┘
            │                      │
            ↓                      ↓
┌───────────────────┐   ┌─────────────────────────────────────┐
│   MySQL 8.0       │   │  Python Wiki Agent (subprocess)     │
│  ┌──────────────┐ │   │  ┌─────────────────────────────┐   │
│  │ users        │ │   │  │ wiki_agent.py               │   │
│  │ conversations│ │   │  │  ├─ list_files()            │   │
│  │ messages     │ │   │  │  ├─ read_file()             │   │
│  │ settings     │ │   │  │  ├─ search_content()        │   │
│  │ prompts      │ │   │  │  └─ write_file()            │   │
│  │ knowledge_*  │ │   │  │                             │   │
│  └──────────────┘ │   │  │ wiki_query.py (read-only)  │   │
└───────────────────┘   │  │  ├─ list_files()            │   │
                        │  │  ├─ search_content()        │   │
                        │  │  └─ read_file()             │   │
                        │  └─────────────────────────────┘   │
                        └────────────┬────────────────────────┘
                                     │
                                     ↓
                        ┌─────────────────────────────────────┐
                        │  DeepSeek API (tool-call)           │
                        │  - model: deepseek-v4-pro           │
                        │  - endpoint: api.deepseek.com       │
                        └─────────────────────────────────────┘
```

---

## 核心模块

### 1. 认证系统

#### JWT 认证流程
```
POST /api/auth/login
  ↓
验证 username/password (bcrypt)
  ↓
生成 JWT token (含 user_id, role)
  ↓
返回 { token, user: { id, username, role } }
  ↓
前端存 localStorage → 后续请求 Authorization: Bearer <token>
  ↓
authenticateToken 中间件验证 → req.user = decoded
```

#### 权限控制
- **requireAdmin**: role === 'admin' 才能访问（用户管理、设置、Wiki 整理）
- **authenticateToken**: 所有需登录的 API

### 2. 聊天系统

#### 对话流程
```
用户输入消息
  ↓
1. 调用 searchKnowledge(message)
   └─ 执行 wiki_query.py (Python subprocess)
       └─ DeepSeek tool-call: list/search/read wiki 文件
       └─ 返回带引用的答案
  ↓
2. 如果检索成功:
   ├─ 答案注入 systemMessage
   └─ knowledgeItems = [{ title, content, knowledge_base_name }]
  ↓
3. 构建 LLM 请求
   ├─ systemMessage = activePrompt.content + knowledgeItems
   ├─ messages = [...historyMessages, { role: 'user', content: message }]
   └─ fetch LLM API (stream: true)
  ↓
4. SSE 流式返回
   ├─ response.write(`data: ${chunk}\n\n`)
   ├─ 前端 EventSource 接收
   └─ 最后保存完整对话到 MySQL
```

### 3. Wiki 知识库

#### 架构
```
wiki/
├── script/
│   ├── wiki_agent.py    # 整理 agent（可写）
│   └── wiki_query.py    # 查询 agent（只读）
├── 推荐系统架构.md
├── 其他文档.md
└── INDEX.md             # wiki_agent 自动生成的索引
```

#### wiki_agent.py（整理）
**工具函数（tool schema）**：
- `list_files()`: 列出 wiki/ 下所有 .md 文件
- `read_file(path)`: 读取文件内容
- `search_content(keyword)`: 在所有文件中搜索关键词
- `write_file(path, content)`: 写入/更新文件

**调用时机**：管理后台点击"Wiki 整理"按钮

**LLM 任务示例**：
```
扫描本目录所有 markdown 文档，
按主题分类生成 INDEX.md，
每个文档配 1 行中文摘要。
```

#### wiki_query.py（检索）
**工具函数（只读）**：
- `list_files()`: 列出文件
- `search_content(keyword)`: 搜索内容
- `read_file(path)`: 读取文件

**调用时机**：聊天时自动触发检索

**返回格式**：
```
根据以下文档回答：

推荐系统架构.md:
- 打散策略：多样性算法...
- 召回层：...

参考文件：推荐系统架构.md
```

### 4. LLM 配置管理

#### settings 表
| Key | 说明 | 默认值 |
|-----|------|--------|
| `llm_base_url` | API 端点 | `https://api.openai.com/v1/chat/completions` |
| `llm_model` | 模型名 | `gpt-3.5-turbo` |
| `llm_api_key` | API Key | - |

#### 多模型兼容
响应解析兼容：
```javascript
// OpenAI / DeepSeek
data.choices[0].message.content || data.choices[0].message.reasoning_content

// Anthropic
data.content[0].text
```

### 5. Prompt 模板

#### prompts 表
| 字段 | 说明 |
|------|------|
| `name` | 模板名称（如"默认助手"） |
| `content` | system prompt 内容 |
| `is_active` | 是否激活（同时只能一个） |

#### 激活流程
```
POST /api/admin/prompts/{id}/activate
  ↓
1. 将所有 prompts.is_active 设为 false
2. 将 id 对应的 is_active 设为 true
  ↓
聊天时 getActivePrompt() 读取当前激活的模板
```

### 6. 用户隔离

#### 数据库层
所有查询都带 `user_id` 过滤：
```sql
SELECT * FROM conversations WHERE id = ? AND user_id = ?
SELECT * FROM messages WHERE conversation_id IN (
  SELECT id FROM conversations WHERE user_id = ?
)
```

#### 前端层
Logout 时清理：
```typescript
resetChat();           // 清空 chatStore 状态
queryClient.clear();   // 清空 React Query 缓存
logout();              // 清空 auth token
navigate('/login');
```

---

## 数据流

### 聊天消息流

```
用户输入 "推荐系统怎么做"
  ↓
1. POST /api/chat { conversationId, message }
  ↓
2. authenticateToken → req.user = { id: 1, username: 'user1', role: 'user' }
  ↓
3. 验证 conversation 归属：
   SELECT * FROM conversations WHERE id = ? AND user_id = ?
  ↓
4. searchKnowledge("推荐系统怎么做")
   ├─ execSync(`python3 wiki_query.py "推荐系统怎么做"`)
   ├─ wiki_query.py 调用 DeepSeek tool-call:
   │   1. search_content("推荐") → 找到 "推荐系统架构.md"
   │   2. read_file("推荐系统架构.md") → 读取内容
   │   3. LLM 总结 → 返回答案 + 引用
   └─ 返回 { items: [{ title, content, knowledge_base_name }] }
  ↓
5. 构建 systemMessage:
   activePrompt.content + "\n\n以下是从知识库中检索到的相关信息：\n\n【知识 1】\n..."
  ↓
6. fetch LLM API (stream: true)
   ├─ OpenAI/DeepSeek/Anthropic endpoint
   ├─ messages: [{ role: 'system', content: systemMessage }, ...historyMessages, { role: 'user', content: "推荐系统怎么做" }]
   └─ model: settings.llm_model
  ↓
7. SSE 流式返回
   ├─ for await (const chunk of stream):
   │   └─ res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`)
   └─ res.write(`data: [DONE]\n\n`)
  ↓
8. 前端 EventSource 接收
   ├─ onmessage: setStreamingContent(prev => prev + data.content)
   └─ 收到 [DONE]: 保存到 messages 数组
  ↓
9. 后端保存完整对话
   ├─ INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)
   ├─ INSERT INTO messages (conversation_id, role, content) VALUES (?, 'assistant', ?)
   └─ UPDATE conversations SET title = ?, updated_at = NOW() WHERE id = ?
```

---

## 部署架构

### 目录结构
```
/root/llm_test/
├── app.js                 # 主应用（Express server）
├── server.js              # 入口（加载 .env + import app）
├── db.js                  # MySQL 连接池
├── .env                   # 环境变量（DB + PORT）
├── dist/                  # 前端构建产物（Vite build）
├── wiki/
│   ├── script/
│   │   ├── wiki_agent.py
│   │   └── wiki_query.py
│   └── *.md               # Wiki 文档
├── restart.sh             # 部署脚本
└── app.log                # 应用日志（PM2）
```

### restart.sh 部署流程
```bash
1. git pull origin main
2. npm install
3. cd frontend && npm install && npm run build
4. cd .. && pm2 restart llm_test || pm2 start server.js --name llm_test
```

### 环境变量
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=llm_test
JWT_SECRET=your_jwt_secret
PORT=3000
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx  # wiki agent 专用
```

### 进程管理
- **PM2**: 自动重启、日志管理
- **日志**: `pm2 logs llm_test` / `tail -f app.log`

---

## 关键设计决策

### 1. 为什么用 Python subprocess 调用 wiki agent？

**优势**：
- wiki_agent/wiki_query 是独立脚本，可单独测试/维护
- DeepSeek tool-call 实现复杂，Python 代码更清晰
- Node.js 调用简单（execSync），隔离环境变量

**替代方案**：
- 直接在 Node.js 实现 tool-call → 代码复杂、调试困难
- 嵌入 Python 运行时（如 python-shell） → 依赖重

### 3. 为什么 multer 文件名要从 latin1 转 utf8？

**问题**：HTTP `Content-Disposition` header 默认 latin1 编码，中文文件名乱码。

**解决方案**：
```javascript
const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
```

### 3. 为什么 uploads 目录用 `__dirname` 不用 `process.cwd()`？

**问题**：`restart.sh` 的 `cd frontend && npm run build` 会改变 cwd，导致 `process.cwd()` 不可靠。

**解决方案**：
```javascript
const uploadsDir = path.join(__dirname, 'uploads');  // __dirname = app.js 所在目录（绝对路径）
```

---

## 安全性

### 1. 认证
- JWT token 有效期：24h（可配置）
- 密码 bcrypt hash（salt rounds: 10）
- token 存 localStorage（XSS 风险由 CSP 缓解）

### 2. 授权
- 所有 admin API 需 `requireAdmin` 中间件
- conversation/message 查询都带 `user_id` 过滤

### 3. 文件上传
- 限制文件大小：10MB
- 只接受 `.md` 文件（wiki upload）
- 文件名编码修复（防止路径遍历）

### 4. SQL 注入
- 所有查询用参数化（mysql2 prepared statements）

### 5. 跨域
- CORS 允许所有来源（开发环境）
- 生产环境应限制 `origin`

---

## 性能优化

### 1. 数据库
- conversation/message 表按 `user_id` 和 `conversation_id` 索引
- 聊天历史限制最近 20 条（MAX_HISTORY_MESSAGES）
- 总 token 数超限时裁剪早期消息

### 2. 前端
- React Query 缓存（5s staleTime）
- 对话列表 5s 轮询刷新
- Vite code splitting

### 3. 流式输出
- SSE 流式传输，降低首字延迟
- 前端逐字渲染（typewriter effect）

---

## 监控与日志

### 日志级别
```javascript
console.log('[classifyQuery] ...');
console.log('[searchKnowledge] ...');
console.log('[chat] ...');
console.error('[xxx] error:', error.message);
```

### PM2 监控
```bash
pm2 monit                    # 实时监控 CPU/内存
pm2 logs llm_test --lines 50 # 查看日志
```

---

## 未来优化方向

1. **向量数据库**：Qdrant/Milvus 替代关键词匹配（更精准的语义检索）
2. **缓存层**：Redis 缓存 LLM 响应、wiki 内容
3. **多租户**：organization 表，隔离不同团队的 wiki
4. **wiki 版本控制**：Git 管理 wiki/ 目录，记录修改历史
5. **异步任务队列**：Bull/BullMQ 处理 wiki_agent 长任务
6. **前端离线支持**：Service Worker + IndexedDB
7. **RBAC 细粒度权限**：permissions 表，动态权限控制

---

## 附录

### API 文档
完整 API 文档见 `API.md`

### 数据库 Schema
完整 schema 见 `schema.sql`

### 本地开发
```bash
# 后端
npm install
npm run dev

# 前端
cd frontend
npm install
npm run dev
```

### 常见问题
见 `FAQ.md`

---

**文档维护**：每次重大架构变更后更新此文档。


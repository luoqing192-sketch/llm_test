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


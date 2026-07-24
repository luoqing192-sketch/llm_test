# LLM Test

> 多 LLM 集成的智能对话系统 — 意图分类三路路由（知识问答 / 代码生成 / 闲聊拒绝）、多对话并行流式、Wiki 知识库（DeepSeek tool-call agent）

## ✨ 特性

- 🧭 **意图分类路由** — LLM 对用户消息分类（含对话上下文）→ 三路分发：知识问答 / 代码生成 / 闲聊拒绝
- 🤖 **多模型支持** — OpenAI / DeepSeek / Anthropic / 兼容 OpenAI 格式的自定义 API
- 🛠️ **代码生成与预览** — Tool-call 循环（6 工具）+ 动态预览 URL + iframe 实时预览
- 💬 **多对话并行流式** — 按 `conversationId` 隔离流式状态，切换对话不中断后台流
- 🧠 **上下文记忆** — Token-aware 截断 + 最多 20 条历史消息
- 📚 **Wiki 知识库** — LLM tool-call 自动检索、整理 markdown 文档
- 🔐 **用户隔离** — JWT 认证，conversation/message 按 user_id 完全隔离
- ⚙️ **动态配置** — 管理后台实时切换模型、Prompt 模板
- 📝 **文件日志** — console 覆盖，双输出（终端 + `app.log`），10MB 自动轮转
- 🚦 **LLM 请求队列** — FIFO 队列 + 并发上限 + 超时控制，防止 API 限流

## 📖 文档

- **[技术架构文档](./ARCHITECTURE.md)** — 完整架构设计、LLM workflow、数据流、核心模块详解
- **[快速开始](#-快速开始)** — 本地开发 & 部署指南

## 🚀 快速开始

### 前置要求

- Node.js 18+
- MySQL 8.0+
- Python 3.8+ (用于 wiki agent)
- PM2 (生产部署)

### 本地开发

#### 1. 克隆 & 安装依赖

```bash
git clone <repo-url>
cd llm_test
npm install
cd frontend && npm install
```

#### 2. 配置数据库

创建数据库并导入 schema：

```bash
mysql -u root -p
> CREATE DATABASE llm_test CHARACTER SET utf8mb4;
> USE llm_test;
> SOURCE schema.sql;
```

创建 `.env` 文件：

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=llm_test
JWT_SECRET=your_jwt_secret_here
DEEPSEEK_API_KEY=sk-xxxxx     # wiki agent 专用
LLM_MAX_CONCURRENT=5          # 队列并发上限
LLM_REQUEST_TIMEOUT=60000     # 队列超时(ms)
```

#### 3. 启动开发服务器

后端：

```bash
npm run dev
# 或
node server.js
```

前端：

```bash
cd frontend
npm run dev
```

访问：
- 前端：http://localhost:5173
- 后端：http://localhost:3000

#### 4. 默认管理员账户

```
用户名：admin
密码：admin123
```

登录后在管理后台修改密码。

### 生产部署

#### 远程服务器（推荐使用 `restart.sh`）

```bash
# 首次部署
git clone <repo-url> /root/llm_test
cd /root/llm_test
cp .env.example .env
# 编辑 .env 配置数据库和密钥
vim .env

# 创建数据库
mysql -u root -p < schema.sql

# 构建 & 启动
chmod +x restart.sh
./restart.sh
```

#### restart.sh 自动化流程

```bash
./restart.sh
# 1. git pull 最新代码
# 2. npm install（后端 + 前端）
# 3. npm run build（Vite 构建前端）
# 4. pm2 restart（重启应用）
```

> 入口 `server.js` 启动时会：初始化日志（检查轮转 + 覆盖 console）→ 加载 `.env`（按 `__dirname` 定位）→ 检测 `frontend/dist` 不存在则自动构建 → 加载 Express 应用 → 确保默认 admin 存在 → 监听端口。

#### 检查状态

```bash
pm2 status               # 查看进程状态
pm2 logs llm_test        # 查看日志
tail -f app.log          # 实时日志
```

## 🗂️ 项目结构

```
llm_test/
├── server.js                # 入口（logger + env + auto-build + start）
├── app.js                   # Express 主应用（路由 + LLM workflow）
├── logger.js                # 日志模块（console 覆盖 + 文件写入 + 10MB 轮转）
├── db.js                    # MySQL 连接池
├── auth.js                  # JWT 中间件
├── init-admin.js            # 默认管理员初始化
├── .env                     # 环境变量
├── restart.sh               # 部署脚本
├── schema.sql               # 数据库 schema
├── app.log                  # 应用日志（自动轮转）
├── ARCHITECTURE.md          # 技术架构文档 ⭐
├── queue/
│   └── llm-queue.js         # LLM 请求队列（FIFO + 并发控制 + 超时）
├── tools/
│   └── code-generator.js    # 6 个代码生成工具（tool-call）
├── demo_code/               # 代码预览文件（按 conversationId 隔离）
│   ├── 1/
│   └── 2/
├── wiki/                    # Wiki 知识库
│   ├── script/
│   │   ├── wiki_agent.py    # 整理 agent（读写，tool-call）
│   │   └── wiki_query.py    # 查询 agent（只读，tool-call）
│   └── *.md                 # Wiki 文档 + INDEX.md 索引
├── frontend/                # React 前端
│   ├── src/
│   │   ├── components/
│   │   ├── stores/          # Zustand（chatStore: 流式状态按 convId 隔离）
│   │   ├── hooks/           # TanStack Query hooks
│   │   └── services/        # API 封装（fetch + SSE）
│   └── dist/                # 构建产物
└── dist/                    # 前端构建产物（部署用）
```

## 🔧 配置说明

### LLM 配置

在管理后台 → **系统设置** 中配置：

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `llm_base_url` | API 完整端点 | `https://api.openai.com/v1/chat/completions` |
| `llm_model` | 模型名称 | `gpt-3.5-turbo` / `deepseek-v4-pro` |
| `llm_api_key` | API 密钥 | `sk-xxxxx` |
| `llm_temperature` | 温度 | `0.7`（默认） |
| `llm_max_tokens` | 最大 tokens | `4096`（默认） |
| `llm_top_p` | Top-P | `0.9`（默认） |

支持的 API：
- OpenAI (ChatGPT)
- DeepSeek
- Anthropic (Claude)
- 兼容 OpenAI 格式的自定义 API

### LLM Workflow（三路路由）

```
POST /api/chat { conversationId, message }
  ↓
Step 1: 意图分类（LLM，含最近 6 条上下文，temperature=0.1）
  ↓
Step 2: 路由分发
  ├─ knowledge_qa → wiki_query.py 检索 + 流式输出
  ├─ generate_page → tool-call 循环（最多 10 次）+ 预览 URL
  └─ casual_chat  → 拒绝消息 + 功能引导
```

### 代码生成工具（tool-call）

| 工具 | 功能 | 安全措施 |
|------|------|----------|
| `search_codebase` | 搜索代码片段 | 限定 baseDir |
| `read_file` | 读取文件（支持行范围） | safePath 路径检查 |
| `get_project_structure` | 目录树结构 | 限定深度 |
| `get_symbol_definition` | 查找符号定义 | 限定 JS/TS 文件 |
| `generate_code` | 生成/修改文件（4 种模式） | safePath + 自动建目录 |
| `run_command` | 执行命令 | 白名单 + 30s 超时 |

每个 conversation 独立目录 `demo_code/{conversationId}/`，预览地址：`/preview/{conversationId}/{file}`。

### Wiki 知识库

#### 上传文档

管理后台 → **知识库** → 上传 `.md` 文件 → 立即生效

#### Wiki 整理

点击 **「Wiki 整理」按钮** → DeepSeek agent 自动：
1. 扫描所有 `.md` 文件
2. 按主题分类
3. 生成 `INDEX.md` 索引（每个文档 1 行摘要）

#### 工作原理

```
用户问 "推荐系统怎么做"
  ↓
意图分类 → knowledge_qa
  ↓
调用 wiki_query.py（DeepSeek tool-call）
  ↓
LLM 自动：list → search → read → 总结 + 引用
  ↓
注入 system prompt → 主 LLM 基于 wiki 内容流式回答
```

## 📝 使用指南

### 聊天功能

1. 登录后自动创建新会话
2. 左侧边栏管理历史对话（可同时进行多个对话的流式请求，互不干扰）
3. 输入消息 → LLM 意图分类 → 三路路由 → 流式输出
4. 知识类问题自动检索 Wiki 知识库（通过 LLM tool-call）
5. 生成页面类需求会触发 tool-call 循环，完成后给出可点击预览链接 + iframe

### 管理后台

访问路径：`/admin`（需 admin 权限）

功能模块：
- **用户管理** — 创建/删除用户，修改密码
- **系统设置** — 配置 LLM API（endpoint / model / key / 采样参数）
- **Prompt 模板** — 管理 system prompt，切换激活模板（同时仅一个激活）
- **知识库** — Wiki 文件上传、删除、自动整理

## 🛠️ 开发

### 技术栈

- **后端**: Node.js 18+ (ESM) + Express + MySQL 8.0 (mysql2/promise) + JWT
- **前端**: React 18 + TypeScript + Ant Design 5 + Vite 6
- **状态管理**: Zustand（chatStore 流式隔离）+ TanStack Query（server state 缓存）
- **HTTP / 流式**: 原生 fetch + SSE
- **Wiki Agent**: Python 3.8+ + DeepSeek tool-call
- **日志**: logger.js（console 覆盖 + 文件写入 + 10MB 轮转）
- **队列**: queue/llm-queue.js（FIFO + 并发控制 + 超时）

### 核心依赖

后端：
```json
{
  "express": "^4.18.2",
  "mysql2": "^3.6.5",
  "jsonwebtoken": "^9.0.2",
  "bcryptjs": "^2.4.3",
  "multer": "^1.4.5-lts.1",
  "dotenv": "^16.3.1"
}
```

前端：
```json
{
  "react": "^18.2.0",
  "antd": "^5.12.0",
  "zustand": "^4.4.7",
  "@tanstack/react-query": "^5.12.0"
}
```

### 调试

```bash
# 后端日志
pm2 logs llm_test
tail -f app.log

# 数据库查询
mysql -u root -p llm_test
> SELECT * FROM conversations WHERE user_id = 1;

# Python agent 测试
cd wiki/script
python3 wiki_query.py "推荐系统怎么做"
```

## 🔐 安全性

- JWT token 有效期 30d（可配置 `JWT_EXPIRES_IN`）
- 密码 bcrypt hash（salt rounds: 10）
- SQL 参数化查询（mysql2 prepared statements，防注入）
- conversation/message 按 user_id 完全隔离
- 文件上传限制 10MB，Wiki 仅接受 `.md`，文件名 latin1→utf8 修复
- 代码生成：`safePath()` 防路径遍历 + `run_command` 白名单（ls/cat/find/node/npm/npx/echo/mkdir）+ 30s 超时
- 预览安全：`X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'` + iframe sandbox

**生产环境建议**：
- 修改默认 admin 密码
- 配置 HTTPS
- 限制 CORS origin
- 定期备份数据库

## 📊 监控

```bash
# PM2 监控
pm2 monit                    # 实时 CPU/内存
pm2 logs llm_test --lines 50 # 日志

# 数据库
mysql -u root -p llm_test
> SELECT COUNT(*) FROM messages;
> SHOW PROCESSLIST;
```

## 🐛 常见问题

### 1. 上传文件显示 0kb

**原因**：`uploadsDir` 路径错误（`restart.sh` 中 `cd frontend` 改变了 cwd）

**解决**：使用 `__dirname` 代替 `process.cwd()`

### 2. 中文文件名乱码

**原因**：HTTP `Content-Disposition` header 默认 latin1 编码

**解决**：`Buffer.from(file.originalname, 'latin1').toString('utf8')`

### 3. 不同用户能看到对方对话

**原因**：logout 时未清空 chatStore 和 React Query 缓存

**解决**：`handleLogout` 中调用 `resetChat()` + `queryClient.clear()`

### 4. 切换对话时流式输出中断

**原因**：传统全局 `isStreaming` 状态，切换对话必须中断流

**解决**：改用 `streamStates: Record<conversationId, StreamState>` 按对话隔离，SSE 回调闭包捕获 `convId` 写入正确的状态槽

## 📄 License

MIT

## 👥 贡献

欢迎 PR！请先阅读 [ARCHITECTURE.md](./ARCHITECTURE.md) 了解架构设计。

---

**维护者**: qing + AI Assistant  
**最后更新**: 2026-06-26

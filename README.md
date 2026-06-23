# AI 聊天助手

企业级 AI 聊天助手平台，支持 RAG 知识库检索增强、LLM 并发控制、管理后台。

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js 22 + Express.js 4 (ESM) |
| 数据库 | MySQL 8.0 |
| 向量库 | Qdrant (文档嵌入 + 语义检索) |
| LLM | OpenAI-compatible API (默认阿里云 Qwen) |
| 前端 | React 18 + TypeScript + Vite + Ant Design 5 |
| 状态管理 | Zustand (客户端) + TanStack Query (服务端) |
| 部署 | Docker Compose (app + MySQL + Qdrant + Nginx) |

## 快速开始

### 前置要求

- Node.js 22+
- MySQL 8.0
- Qdrant (向量数据库)

### 开发环境

```bash
# 1. 安装后端依赖
npm install

# 2. 配置环境变量
cp .env.development .env
# 编辑 .env 填写数据库和 LLM 配置

# 3. 初始化数据库
mysql -u root -p < init-db.sql

# 4. 安装前端依赖
cd frontend && npm install && cd ..

# 5. 启动后端
npm run dev

# 6. 启动前端开发服务器（新终端）
cd frontend && npm run dev
```

### Docker 一键部署

```bash
# 使用 docker-compose 启动全部服务
./deploy.sh

# 或手动执行
docker-compose up -d
```

## 项目结构

```
├── app.js                    # Express 应用（所有路由）
├── server.js                 # 服务启动入口
├── db.js                     # MySQL 连接池
├── auth.js                   # JWT 认证中间件
├── qdrant.js                 # Qdrant 向量数据库客户端
├── embeddings.js             # OpenAI 嵌入服务
├── text-splitter.js          # 文本分块工具
├── queue/
│   └── llm-queue.js          # LLM 请求队列（FIFO + 并发控制）
├── frontend/                 # React 前端
│   └── src/
│       ├── components/       # UI 组件
│       ├── pages/            # 页面
│       ├── stores/           # Zustand 状态
│       ├── hooks/            # React Query hooks
│       ├── services/         # API 客户端 + SSE
│       └── types/            # TypeScript 类型
├── tests/
│   ├── unit/                 # 单元测试
│   ├── integration/          # 集成测试
│   ├── e2e/                  # E2E 测试 (Playwright)
│   └── stress/               # 压力测试
├── public/                   # Legacy Vanilla JS 前端
├── docker-compose.yml        # 容器编排
└── .github/workflows/ci.yml  # CI/CD 管道
```

## API 端点

### 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录 |
| GET | `/api/auth/me` | 当前用户信息 |

### 对话
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/conversations` | 对话列表 |
| POST | `/api/conversations` | 创建对话 |
| GET | `/api/conversations/:id/messages` | 获取消息 |
| DELETE | `/api/conversations/:id` | 删除对话 |
| POST | `/api/chat` | 发送消息 (SSE 流式) |
| POST | `/api/chat/upload` | 上传文件 |

### 系统
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/queue/status` | LLM 队列状态 |

### 管理 (需 admin 权限)
- 用户管理 CRUD
- LLM 配置
- 提示词管理 (CRUD + 激活/停用)
- 知识库管理 + 知识条目 CRUD
- 文档上传 + 处理

## 功能特性

- ✅ **SSE 流式聊天** — LLM 回复实时流式输出
- ✅ **RAG 检索增强** — Qdrant 向量语义搜索知识库
- ✅ **LLM 并发控制** — FIFO 队列 + 可配置并发数 + 超时
- ✅ **多轮对话** — 历史消息上下文管理 + token 限制
- ✅ **文件上传** — 聊天中上传文件、管理文档
- ✅ **管理后台** — 用户/设置/提示词/知识库全管理
- ✅ **对话标题自动生成** — 首轮对话自动提取标题

## 测试

```bash
# 单元测试
npm test

# 集成测试（需要 MySQL + Qdrant）
npx vitest run tests/integration

# E2E 测试（需要运行中的服务）
npm run test:e2e

# 压力测试（需要运行中的服务）
npm run test:stress
```

## 默认账户

- 管理员: `admin` / `123456`

## License

MIT

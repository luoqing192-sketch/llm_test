# LLM Test

> 多 LLM 集成的智能对话系统，支持 Wiki 知识库（DeepSeek tool-call agent）

## ✨ 特性

- 🤖 **多模型支持** — OpenAI / DeepSeek / Anthropic / 自定义 API
- 📚 **Wiki 知识库** — LLM tool-call 自动检索、整理 markdown 文档
- 💬 **流式对话** — SSE 实时流式输出
- 🔐 **用户隔离** — JWT 认证，多用户完全隔离
- ⚙️ **动态配置** — 管理后台实时切换模型、Prompt 模板
- 🎯 **智能检索** — 关键词 n-gram 匹配，自动触发知识库查询

## 📖 文档

- **[技术架构文档](./ARCHITECTURE.md)** — 完整架构设计、数据流、核心模块详解
- **[快速开始](#快速开始)** — 本地开发 & 部署指南

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
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=llm_test
JWT_SECRET=your_jwt_secret_here
PORT=3000
DEEPSEEK_API_KEY=sk-xxxxx  # wiki agent 专用
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

#### 检查状态

```bash
pm2 status               # 查看进程状态
pm2 logs llm_test        # 查看日志
tail -f app.log          # 实时日志
```

## 🗂️ 项目结构

```
llm_test/
├── server.js                # 入口（加载 .env）
├── app.js                   # Express 主应用
├── db.js                    # MySQL 连接池
├── .env                     # 环境变量
├── restart.sh               # 部署脚本
├── schema.sql               # 数据库 schema
├── ARCHITECTURE.md          # 技术架构文档 ⭐
├── wiki/                    # Wiki 知识库
│   ├── script/
│   │   ├── wiki_agent.py    # 整理 agent（tool-call）
│   │   └── wiki_query.py    # 查询 agent（tool-call）
│   └── *.md                 # Wiki 文档
├── frontend/                # React 前端
│   ├── src/
│   │   ├── components/
│   │   ├── stores/          # Zustand 状态管理
│   │   ├── hooks/           # TanStack Query hooks
│   │   └── services/        # API 封装
│   └── dist/                # 构建产物
└── dist/                    # 前端构建产物（部署用）
```

## 🔧 配置说明

### LLM 配置

在管理后台 → **系统设置** 中配置：

| 配置项 | 说明 | 示例 |
|--------|------|------|
| LLM Base URL | API 端点 | `https://api.openai.com/v1/chat/completions` |
| LLM Model | 模型名称 | `gpt-3.5-turbo` / `deepseek-v4-pro` |
| LLM API Key | API 密钥 | `sk-xxxxx` |

支持的 API：
- OpenAI (ChatGPT)
- DeepSeek
- Anthropic (Claude)
- 兼容 OpenAI 格式的自定义 API

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
关键词匹配触发（"推荐"、"系统" 匹配 "推荐系统架构.md"）
  ↓
调用 wiki_query.py（DeepSeek tool-call）
  ↓
LLM 自动：search → read → 总结 + 引用
  ↓
注入 system prompt → 主 LLM 基于 wiki 内容回答
```

## 📝 使用指南

### 聊天功能

1. 登录后自动创建新会话
2. 左侧边栏管理历史对话
3. 输入消息 → 流式输出
4. 涉及知识库的问题自动检索 wiki

### 管理后台

访问路径：`/admin`（需 admin 权限）

功能模块：
- **用户管理** — 创建/删除用户，修改密码
- **系统设置** — 配置 LLM API
- **Prompt 模板** — 管理 system prompt，切换激活模板
- **知识库** — Wiki 文件管理 + 整理

## 🛠️ 开发

### 技术栈

- **后端**: Node.js + Express + MySQL + JWT
- **前端**: React + TypeScript + Ant Design + Vite
- **状态管理**: Zustand + TanStack Query
- **Wiki Agent**: Python + DeepSeek tool-call

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
  "@tanstack/react-query": "^5.12.0",
  "axios": "^1.6.2"
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

- JWT token 24h 过期
- 密码 bcrypt hash（salt rounds: 10）
- SQL 参数化查询（防注入）
- 文件上传限制 10MB
- conversation/message 按 user_id 完全隔离

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

**原因**：`uploadsDir` 路径错误（cwd 问题）

**解决**：已修复，使用 `__dirname` 代替 `process.cwd()`

### 2. DeepSeek 分类失败

**原因**：reasoning 模式把 token 耗在 `reasoning_content` 上

**解决**：改用关键词 n-gram 匹配，不再依赖 LLM 分类

### 3. 不同用户能看到对方对话

**原因**：logout 时未清空 chatStore 和 React Query 缓存

**解决**：`handleLogout` 中调用 `resetChat()` + `queryClient.clear()`

### 4. Wiki 检索匹配不到

**原因**：旧的整体匹配（"推荐系统架构" 作为整体关键词）

**解决**：改用 2-gram 分词（"推荐"、"系统"、"架构"）

## 📄 License

MIT

## 👥 贡献

欢迎 PR！请先阅读 [ARCHITECTURE.md](./ARCHITECTURE.md) 了解架构设计。

---

**维护者**: qing + Claude Opus 4.6  
**最后更新**: 2026-06-24

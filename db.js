import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 按脚本所在目录加载 .env，与 cwd 解耦（db.js 在 import 阶段就会建连接池，
// 此时 server.js 的 dotenv 还没执行，所以必须在此处用绝对路径加载）
const envPath = path.join(__dirname, '.env');
const envDevPath = path.join(__dirname, '.env.development');
dotenv.config({ path: fs.existsSync(envPath) ? envPath : envDevPath });

let pool;
let checkHealth;

if (process.env.USE_MOCK_DB === 'true') {
  // ==================== Mock Mode (内存存储，不连接 MySQL) ====================
  console.log('🧪 Mock DB mode enabled (USE_MOCK_DB=true)');

  const bcrypt = await import('bcrypt');

  // 内存存储
  const store = {
    users: [],
    conversations: [],
    messages: [],
    settings: [],
    prompts: []
  };

  // 自增 ID 计数器
  const counters = { users: 1, conversations: 0, messages: 0, settings: 6, prompts: 0 };

  // 初始化 admin 用户
  const adminHash = bcrypt.default.hashSync('123456', 10);
  store.users.push({ id: 1, username: 'admin', password_hash: adminHash, role: 'admin', created_at: new Date().toISOString() });

  // 初始化默认设置
  store.settings.push(
    { id: 1, setting_key: 'llm_base_url', setting_value: process.env.LLM_API_BASE_URL || 'https://api.deepseek.com/v1/chat/completions', updated_at: new Date().toISOString() },
    { id: 2, setting_key: 'llm_api_key', setting_value: process.env.LLM_API_KEY || '', updated_at: new Date().toISOString() },
    { id: 3, setting_key: 'llm_model', setting_value: process.env.LLM_MODEL || 'deepseek-chat', updated_at: new Date().toISOString() },
    { id: 4, setting_key: 'llm_temperature', setting_value: '0.7', updated_at: new Date().toISOString() },
    { id: 5, setting_key: 'llm_max_tokens', setting_value: '4096', updated_at: new Date().toISOString() },
    { id: 6, setting_key: 'llm_top_p', setting_value: '0.9', updated_at: new Date().toISOString() }
  );

  // SQL 模式匹配 mock 实现
  function mockQuery(sql, params = []) {
    const s = sql.trim().replace(/\s+/g, ' ');

    // ---- USERS ----
    if (/^SELECT .* FROM users WHERE username = \?/i.test(s)) {
      const rows = store.users.filter(u => u.username === params[0]);
      return [rows, []];
    }
    if (/^SELECT .* FROM users WHERE id = \?/i.test(s)) {
      const rows = store.users.filter(u => u.id === Number(params[0]));
      return [rows, []];
    }
    if (/^SELECT .* FROM users ORDER BY/i.test(s)) {
      const rows = [...store.users].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return [rows, []];
    }
    if (/^INSERT INTO users/i.test(s)) {
      const id = ++counters.users;
      store.users.push({ id, username: params[0], password_hash: params[1], role: params[2], created_at: new Date().toISOString() });
      return [{ insertId: id, affectedRows: 1 }, undefined];
    }
    if (/^UPDATE users SET password_hash = \? WHERE id = \?/i.test(s)) {
      const user = store.users.find(u => u.id === Number(params[1]));
      if (user) user.password_hash = params[0];
      return [{ affectedRows: user ? 1 : 0 }, undefined];
    }
    if (/^DELETE FROM users WHERE id = \?/i.test(s)) {
      const idx = store.users.findIndex(u => u.id === Number(params[0]));
      if (idx !== -1) store.users.splice(idx, 1);
      return [{ affectedRows: idx !== -1 ? 1 : 0 }, undefined];
    }

    // ---- CONVERSATIONS ----
    if (/^SELECT .* FROM conversations WHERE id = \? AND user_id = \?/i.test(s)) {
      const rows = store.conversations.filter(c => c.id === Number(params[0]) && c.user_id === Number(params[1]));
      return [rows, []];
    }
    if (/^SELECT .* FROM conversations WHERE id = \?/i.test(s)) {
      const rows = store.conversations.filter(c => c.id === Number(params[0]));
      return [rows, []];
    }
    if (/^SELECT .* FROM conversations WHERE user_id = \? ORDER BY/i.test(s)) {
      const rows = store.conversations
        .filter(c => c.user_id === Number(params[0]))
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      return [rows, []];
    }
    if (/^INSERT INTO conversations/i.test(s)) {
      const id = ++counters.conversations;
      const now = new Date().toISOString();
      store.conversations.push({ id, user_id: Number(params[0]), title: params[1], created_at: now, updated_at: now });
      return [{ insertId: id, affectedRows: 1 }, undefined];
    }
    if (/^UPDATE conversations SET title = \?, updated_at/i.test(s)) {
      const conv = store.conversations.find(c => c.id === Number(params[1]));
      if (conv) { conv.title = params[0]; conv.updated_at = new Date().toISOString(); }
      return [{ affectedRows: conv ? 1 : 0 }, undefined];
    }
    if (/^UPDATE conversations SET updated_at/i.test(s)) {
      const conv = store.conversations.find(c => c.id === Number(params[0]));
      if (conv) { conv.updated_at = new Date().toISOString(); }
      return [{ affectedRows: conv ? 1 : 0 }, undefined];
    }
    if (/^DELETE FROM conversations WHERE id = \? AND user_id = \?/i.test(s)) {
      const idx = store.conversations.findIndex(c => c.id === Number(params[0]) && c.user_id === Number(params[1]));
      if (idx !== -1) {
        store.conversations.splice(idx, 1);
        store.messages = store.messages.filter(m => m.conversation_id !== Number(params[0]));
      }
      return [{ affectedRows: idx !== -1 ? 1 : 0 }, undefined];
    }
    if (/^DELETE FROM conversations WHERE id = \?/i.test(s)) {
      const idx = store.conversations.findIndex(c => c.id === Number(params[0]));
      if (idx !== -1) store.conversations.splice(idx, 1);
      return [{ affectedRows: idx !== -1 ? 1 : 0 }, undefined];
    }

    // ---- MESSAGES ----
    if (/^SELECT .* FROM messages WHERE conversation_id = \? ORDER BY/i.test(s)) {
      const rows = store.messages
        .filter(m => m.conversation_id === Number(params[0]))
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      return [rows, []];
    }
    if (/^INSERT INTO messages/i.test(s)) {
      const id = ++counters.messages;
      const now = new Date().toISOString();
      store.messages.push({ id, conversation_id: Number(params[0]), role: params[1], content: params[2], created_at: now });
      return [{ insertId: id, affectedRows: 1 }, undefined];
    }
    if (/^DELETE FROM messages WHERE conversation_id = \?/i.test(s)) {
      const before = store.messages.length;
      store.messages = store.messages.filter(m => m.conversation_id !== Number(params[0]));
      return [{ affectedRows: before - store.messages.length }, undefined];
    }

    // ---- SETTINGS ----
    if (/^SELECT \* FROM settings ORDER BY/i.test(s)) {
      const rows = [...store.settings].sort((a, b) => a.setting_key.localeCompare(b.setting_key));
      return [rows, []];
    }
    if (/^SELECT \* FROM settings$/i.test(s)) {
      return [[...store.settings], []];
    }
    if (/^INSERT INTO settings .* ON DUPLICATE KEY UPDATE/i.test(s)) {
      const existing = store.settings.find(st => st.setting_key === params[0]);
      if (existing) {
        existing.setting_value = params[1];
        existing.updated_at = new Date().toISOString();
      } else {
        const id = ++counters.settings;
        store.settings.push({ id, setting_key: params[0], setting_value: params[1], updated_at: new Date().toISOString() });
      }
      return [{ affectedRows: 1 }, undefined];
    }
    if (/^UPDATE settings SET/i.test(s)) {
      return [{ affectedRows: 1 }, undefined];
    }

    // ---- PROMPTS ----
    if (/^SELECT \* FROM prompts WHERE is_active = (true|1) LIMIT 1/i.test(s)) {
      const rows = store.prompts.filter(p => p.is_active === true || p.is_active === 1);
      return [rows.slice(0, 1), []];
    }
    if (/^SELECT \* FROM prompts WHERE id = \?/i.test(s)) {
      const rows = store.prompts.filter(p => p.id === Number(params[0]));
      return [rows, []];
    }
    if (/^SELECT \* FROM prompts ORDER BY/i.test(s)) {
      const rows = [...store.prompts].sort((a, b) => {
        if (a.is_active && !b.is_active) return -1;
        if (!a.is_active && b.is_active) return 1;
        return new Date(b.created_at) - new Date(a.created_at);
      });
      return [rows, []];
    }
    if (/^INSERT INTO prompts/i.test(s)) {
      const id = ++counters.prompts;
      const now = new Date().toISOString();
      store.prompts.push({ id, name: params[0], content: params[1], description: params[2], is_active: params[3] ? true : false, created_at: now, updated_at: now });
      return [{ insertId: id, affectedRows: 1 }, undefined];
    }
    if (/^UPDATE prompts SET is_active = false WHERE id != \?/i.test(s)) {
      store.prompts.forEach(p => { if (p.id !== Number(params[0])) p.is_active = false; });
      return [{ affectedRows: store.prompts.length }, undefined];
    }
    if (/^UPDATE prompts SET is_active = false$/i.test(s)) {
      store.prompts.forEach(p => { p.is_active = false; });
      return [{ affectedRows: store.prompts.length }, undefined];
    }
    if (/^UPDATE prompts SET is_active = true WHERE id = \?/i.test(s)) {
      const prompt = store.prompts.find(p => p.id === Number(params[0]));
      if (prompt) prompt.is_active = true;
      return [{ affectedRows: prompt ? 1 : 0 }, undefined];
    }
    if (/^UPDATE prompts SET is_active = false WHERE id = \?/i.test(s)) {
      const prompt = store.prompts.find(p => p.id === Number(params[0]));
      if (prompt) prompt.is_active = false;
      return [{ affectedRows: prompt ? 1 : 0 }, undefined];
    }
    if (/^UPDATE prompts SET name = \?, content = \?, description = \?, is_active = \? WHERE id = \?/i.test(s)) {
      const prompt = store.prompts.find(p => p.id === Number(params[4]));
      if (prompt) {
        prompt.name = params[0];
        prompt.content = params[1];
        prompt.description = params[2];
        prompt.is_active = params[3] ? true : false;
        prompt.updated_at = new Date().toISOString();
      }
      return [{ affectedRows: prompt ? 1 : 0 }, undefined];
    }
    if (/^DELETE FROM prompts WHERE id = \?/i.test(s)) {
      const idx = store.prompts.findIndex(p => p.id === Number(params[0]));
      if (idx !== -1) store.prompts.splice(idx, 1);
      return [{ affectedRows: idx !== -1 ? 1 : 0 }, undefined];
    }

    // ---- Fallback: unmatched query ----
    console.warn(`[MockDB] Unhandled SQL: ${s}`, params);
    return [[], []];
  }

  // Mock pool object
  pool = {
    async query(sql, params) {
      return mockQuery(sql, params);
    },
    async getConnection() {
      return {
        async ping() {},
        release() {},
        async query(sql, params) { return mockQuery(sql, params); }
      };
    },
    on() {} // no-op for event listeners
  };

  checkHealth = async function () {
    return true;
  };

} else {
  // ==================== Real MySQL Mode ====================
  const mysql = (await import('mysql2/promise')).default;

  // 启动期校验：缺少数据库配置时直接报错，避免运行到登录才抛误导性的 500
  const requiredDbVars = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DATABASE'];
  const missingDbVars = requiredDbVars.filter((v) => !process.env[v]);
  if (missingDbVars.length > 0) {
    console.error(
      `❌ 数据库配置缺失: ${missingDbVars.join(', ')}。` +
        `请确认 .env 文件存在且已正确填写（参考 .env.production）。`
    );
  }

  pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,

    // 连接池配置
    waitForConnections: true,
    connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT) || 10,
    queueLimit: 100,
    acquireTimeout: 60000,
    timeout: 60000,

    // 性能优化
    multipleStatements: false,
    charset: 'utf8mb4',
    dateStrings: true,

    // 连接健康检查
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });

  // 连接池事件监听
  pool.on('acquire', (connection) => {
    console.log(`Connection ${connection.threadId} acquired`);
  });

  pool.on('release', (connection) => {
    console.log(`Connection ${connection.threadId} released`);
  });

  pool.on('connection', (connection) => {
    console.log(`New connection ${connection.threadId} created`);
  });

  // 健康检查函数
  checkHealth = async function () {
    try {
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();
      return true;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    }
  };
}

export { checkHealth };
export default pool;

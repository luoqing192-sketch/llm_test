import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from './db.js';
import { authenticateToken, requireAdmin } from './auth.js';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { splitTextIntoChunks, extractTextFromBuffer } from './text-splitter.js';
import llmQueue from './queue/llm-queue.js';
import { toolDefinitions, executeToolCall } from './tools/code-generator.js';

dotenv.config();

const CODE_GENERATION_PROMPT = `\n\n## 代码生成能力\n\n你具备前端代码生成和文件操作能力。当用户要求你创建、修改前端页面或 Web 应用时，请使用以下工具：\n\n### 工作流程\n1. 如果是新项目，先使用 get_project_structure 查看当前已有文件\n2. 使用 generate_code 工具创建文件，每个项目必须包含 index.html 作为入口文件\n3. 使用 read_file 验证生成的文件内容是否正确\n4. 如需修改已有文件，先 read_file 了解内容，再用 generate_code 的 replace/insert/append 模式修改\n5. 可选：使用 search_codebase 搜索已有代码中的相关实现作为参考\n\n### 代码生成规则\n- 根据用户需求复杂度自行决定技术方案：简单页面用纯 HTML/CSS/JS，复杂交互可引入框架\n- 所有生成的项目必须有 index.html 作为入口，确保可以直接在浏览器中打开预览\n- CSS 样式直接写在 HTML 文件的 <style> 标签中，或创建独立的 .css 文件并在 HTML 中引用\n- JavaScript 代码可以内联在 <script> 标签中，或创建独立的 .js 文件并引用\n- 确保生成的代码美观、可用、符合现代 Web 标准\n- 使用中文作为界面语言（除非用户要求其他语言）\n\n### 注意事项\n- 只在用户明确要求生成前端页面/组件/应用时才使用这些工具\n- 普通的聊天对话、知识问答不要使用这些工具\n- 如果用户要求修改之前生成的页面，使用 read_file 和 get_project_structure 了解现有代码后再修改`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize upload directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Initialize demo_code directory for code preview
const demoCodeDir = path.join(__dirname, 'demo_code');
if (!fs.existsSync(demoCodeDir)) {
  fs.mkdirSync(demoCodeDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // multer 的 originalname 默认 latin1 编码，中文会乱码，需转 utf8
    const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    file.originalname = decodedName;
    cb(null, uniqueSuffix + '-' + decodedName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 预览服务 - 静态文件服务用于代码预览
app.use('/preview', express.static(path.join(__dirname, 'demo_code'), {
  setHeaders: (res) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  }
}));

// Serve React frontend build (primary frontend)
const frontendDistPath = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
} else {
  console.warn('⚠️ React frontend not built. Run: cd frontend && npm run build');
}

// ==================== Health Check ====================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ==================== Queue Status ====================

app.get('/api/queue/status', authenticateToken, (req, res) => {
  res.json(llmQueue.getStatus());
});

// ==================== Auth Routes ====================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const [users] = await pool.query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: '登录失败' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, username, role, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    res.json(users[0]);
  } catch (error) {
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

// ==================== Admin Routes ====================

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, username, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: '获取用户列表失败' });
  }
});

app.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, role = 'user' } = req.body;

    const [existing] = await pool.query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, passwordHash, role]
    );

    res.json({ id: result.insertId, username, role });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: '创建用户失败' });
  }
});

app.put('/api/admin/users/:id/password', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    const userId = req.params.id;

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [passwordHash, userId]
    );

    res.json({ message: '密码已更新' });
  } catch (error) {
    res.status(500).json({ error: '更新密码失败' });
  }
});

app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ error: '不能删除自己' });
    }

    await pool.query('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ message: '用户已删除' });
  } catch (error) {
    res.status(500).json({ error: '删除用户失败' });
  }
});

// ==================== Settings Routes ====================

app.get('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [settings] = await pool.query('SELECT * FROM settings ORDER BY setting_key');
    const settingsMap = {};
    settings.forEach(s => {
      settingsMap[s.setting_key] = s.setting_value;
    });
    res.json(settingsMap);
  } catch (error) {
    res.status(500).json({ error: '获取设置失败' });
  }
});

app.put('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const settings = req.body;

    for (const [key, value] of Object.entries(settings)) {
      await pool.query(
        'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
        [key, value, value]
      );
    }

    res.json({ message: '设置已更新' });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: '更新设置失败' });
  }
});

// ==================== Prompt Routes ====================

app.get('/api/admin/prompts', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [prompts] = await pool.query('SELECT * FROM prompts ORDER BY is_active DESC, created_at DESC');
    res.json(prompts);
  } catch (error) {
    res.status(500).json({ error: '获取提示词列表失败' });
  }
});

app.post('/api/admin/prompts', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, content, description = '', is_active = false } = req.body;

    if (is_active) {
      await pool.query('UPDATE prompts SET is_active = false');
    }

    const [result] = await pool.query(
      'INSERT INTO prompts (name, content, description, is_active) VALUES (?, ?, ?, ?)',
      [name, content, description, is_active]
    );

    const [prompt] = await pool.query('SELECT * FROM prompts WHERE id = ?', [result.insertId]);
    res.json(prompt[0]);
  } catch (error) {
    console.error('Create prompt error:', error);
    res.status(500).json({ error: '创建提示词失败' });
  }
});

app.put('/api/admin/prompts/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, content, description, is_active } = req.body;
    const promptId = req.params.id;

    if (is_active) {
      await pool.query('UPDATE prompts SET is_active = false WHERE id != ?', [promptId]);
    }

    await pool.query(
      'UPDATE prompts SET name = ?, content = ?, description = ?, is_active = ? WHERE id = ?',
      [name, content, description, is_active, promptId]
    );

    const [prompt] = await pool.query('SELECT * FROM prompts WHERE id = ?', [promptId]);
    res.json(prompt[0]);
  } catch (error) {
    console.error('Update prompt error:', error);
    res.status(500).json({ error: '更新提示词失败' });
  }
});

app.delete('/api/admin/prompts/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const promptId = req.params.id;
    await pool.query('DELETE FROM prompts WHERE id = ?', [promptId]);
    res.json({ message: '提示词已删除' });
  } catch (error) {
    res.status(500).json({ error: '删除提示词失败' });
  }
});

app.post('/api/admin/prompts/:id/activate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const promptId = req.params.id;
    await pool.query('UPDATE prompts SET is_active = false');
    await pool.query('UPDATE prompts SET is_active = true WHERE id = ?', [promptId]);
    res.json({ message: '提示词已激活' });
  } catch (error) {
    res.status(500).json({ error: '激活提示词失败' });
  }
});

app.post('/api/admin/prompts/:id/deactivate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const promptId = req.params.id;
    await pool.query('UPDATE prompts SET is_active = false WHERE id = ?', [promptId]);
    res.json({ message: '提示词已停用' });
  } catch (error) {
    res.status(500).json({ error: '停用提示词失败' });
  }
});

app.get('/api/admin/prompts/active', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [prompts] = await pool.query('SELECT * FROM prompts WHERE is_active = true LIMIT 1');
    res.json(prompts.length > 0 ? prompts[0] : null);
  } catch (error) {
    res.status(500).json({ error: '获取激活提示词失败' });
  }
});

app.post('/api/admin/prompts/test', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { promptContent, testMessage } = req.body;

    if (!promptContent || !testMessage) {
      return res.status(400).json({ error: '提示词内容和测试消息不能为空' });
    }

    const settings = await getLLMSettings();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const messages = [
      { role: 'system', content: promptContent },
      { role: 'user', content: testMessage }
    ];

    const response = await fetch(settings.llm_base_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.llm_api_key}`
      },
      body: JSON.stringify({
        model: settings.llm_model,
        messages: messages,
        stream: true,
        temperature: parseFloat(settings.llm_temperature) || 0.7,
        max_tokens: parseInt(settings.llm_max_tokens) || 4096,
        top_p: parseFloat(settings.llm_top_p) || 0.9
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('LLM API error:', response.status, errorText);
      throw new Error(`LLM API error: ${response.status} ${errorText}`.trim());
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || '';

            if (content) {
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Test prompt error:', error);
    res.write(`data: ${JSON.stringify({ error: '测试失败：' + error.message })}\n\n`);
    res.end();
  }
});

// ==================== Wiki File Management Routes ====================

// List wiki files
app.get('/api/admin/wiki', authenticateToken, async (req, res) => {
  try {
    if (!fs.existsSync(WIKI_DIR)) {
      fs.mkdirSync(WIKI_DIR, { recursive: true });
    }
    const files = fs.readdirSync(WIKI_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const stat = fs.statSync(path.join(WIKI_DIR, f));
        return {
          name: f.replace(/\.md$/, ''),
          filename: f,
          size: stat.size,
          updated_at: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    res.json(files);
  } catch (error) {
    console.error('List wiki files error:', error);
    res.status(500).json({ error: '获取 Wiki 文件列表失败' });
  }
});

// Upload wiki file (.md → wiki/ directory)
app.post('/api/admin/wiki/upload', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }

    if (!fs.existsSync(WIKI_DIR)) {
      fs.mkdirSync(WIKI_DIR, { recursive: true });
    }

    const originalName = req.file.originalname;
    const targetName = originalName.endsWith('.md') ? originalName : originalName + '.md';
    const targetPath = path.join(WIKI_DIR, targetName);

    // 从 multer 临时位置移到 wiki/ 目录
    fs.renameSync(req.file.path, targetPath);

    const stat = fs.statSync(targetPath);
    console.log(`[wiki upload] 文件: ${targetName} | 大小: ${stat.size} | 路径: ${targetPath}`);

    res.json({
      message: 'Wiki 文件上传成功',
      file: {
        name: targetName.replace(/\.md$/, ''),
        filename: targetName,
        size: stat.size,
        updated_at: stat.mtime.toISOString(),
      },
    });
  } catch (error) {
    console.error('Upload wiki file error:', error);
    res.status(500).json({ error: '上传 Wiki 文件失败' });
  }
});

// Delete wiki file
app.delete('/api/admin/wiki/:filename', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const targetName = filename.endsWith('.md') ? filename : filename + '.md';
    const targetPath = path.join(WIKI_DIR, targetName);

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: '文件不存在' });
    }

    fs.unlinkSync(targetPath);
    res.json({ message: 'Wiki 文件已删除' });
  } catch (error) {
    console.error('Delete wiki file error:', error);
    res.status(500).json({ error: '删除 Wiki 文件失败' });
  }
});

// Wiki 整理：调用 wiki_agent.py（DeepSeek tool-call）扫描并整理 wiki 文档
app.post('/api/admin/wiki/organize', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const task = req.body.task || '扫描本目录所有 markdown 文档，按主题分类生成 INDEX.md，每个文档配 1 行中文摘要。';
    const scriptPath = path.join(WIKI_DIR, 'script', 'wiki_agent.py');

    if (!fs.existsSync(scriptPath)) {
      return res.status(500).json({ error: 'wiki_agent.py 不存在' });
    }

    const { execSync } = await import('child_process');
    const env = {
      ...process.env,
      WIKI_DIR: WIKI_DIR,
      LLM_ENDPOINT: 'https://api.deepseek.com/v1/chat/completions',
      LLM_MODEL: 'deepseek-v4-pro',
      LLM_API_KEY: process.env.DEEPSEEK_API_KEY || 'sk-1770fe3369ab47cb9dd4c5a0b4a2480a',
    };

    console.log(`[wiki organize] 任务: ${task}`);
    const output = execSync(
      `python3 "${scriptPath}" "${task.replace(/"/g, '\\"')}"`,
      { env, timeout: 300000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8' }
    );
    console.log(`[wiki organize] 完成`);

    res.json({ message: 'Wiki 整理完成', output });
  } catch (error) {
    console.error('Wiki organize error:', error.message);
    const output = error.stdout || error.stderr || error.message;
    res.status(500).json({ error: 'Wiki 整理失败', output });
  }
});

// Wiki 查询：调用 wiki_query.py（DeepSeek tool-call）检索 wiki 内容
app.post('/api/admin/wiki/query', authenticateToken, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: '缺少问题' });

    const scriptPath = path.join(WIKI_DIR, 'script', 'wiki_query.py');
    if (!fs.existsSync(scriptPath)) {
      return res.status(500).json({ error: 'wiki_query.py 不存在' });
    }

    const { execSync } = await import('child_process');
    const env = {
      ...process.env,
      WIKI_DIR: WIKI_DIR,
      LLM_ENDPOINT: 'https://api.deepseek.com/v1/chat/completions',
      LLM_MODEL: 'deepseek-v4-pro',
      LLM_API_KEY: process.env.DEEPSEEK_API_KEY || 'sk-1770fe3369ab47cb9dd4c5a0b4a2480a',
    };

    const output = execSync(
      `python3 "${scriptPath}" "${question.replace(/"/g, '\\"')}"`,
      { env, timeout: 120000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8' }
    );

    res.json({ answer: output });
  } catch (error) {
    console.error('Wiki query error:', error.message);
    res.status(500).json({ error: 'Wiki 查询失败' });
  }
});

// Chat file upload (any authenticated user)
app.post('/api/chat/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }

    res.json({
      message: '文件上传成功',
      file: {
        id: Date.now(),
        filename: req.file.filename,
        original_name: req.file.originalname,
        size: req.file.size,
        path: req.file.path,
      }
    });
  } catch (error) {
    console.error('Chat upload error:', error);
    res.status(500).json({ error: '上传文件失败' });
  }
});

// ==================== Conversation Routes ====================

app.get('/api/conversations', authenticateToken, async (req, res) => {
  try {
    const [conversations] = await pool.query(
      'SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC',
      [req.user.id]
    );
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: '获取对话列表失败' });
  }
});

app.post('/api/conversations', authenticateToken, async (req, res) => {
  try {
    // Generate unique title based on timestamp if not provided
    const now = new Date();
    const timestamp = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const defaultTitle = `对话 ${timestamp}`;
    const { title = defaultTitle } = req.body;

    const [result] = await pool.query(
      'INSERT INTO conversations (user_id, title) VALUES (?, ?)',
      [req.user.id, title]
    );

    const [conversation] = await pool.query(
      'SELECT * FROM conversations WHERE id = ?',
      [result.insertId]
    );

    res.json(conversation[0]);
  } catch (error) {
    res.status(500).json({ error: '创建对话失败' });
  }
});

app.get('/api/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    const conversationId = req.params.id;

    const [conversations] = await pool.query(
      'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
      [conversationId, req.user.id]
    );

    if (conversations.length === 0) {
      return res.status(404).json({ error: '对话不存在' });
    }

    const [messages] = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    );

    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: '获取消息失败' });
  }
});

app.delete('/api/conversations/:id', authenticateToken, async (req, res) => {
  try {
    const conversationId = req.params.id;

    await pool.query(
      'DELETE FROM conversations WHERE id = ? AND user_id = ?',
      [conversationId, req.user.id]
    );

    res.json({ message: '对话已删除' });
  } catch (error) {
    res.status(500).json({ error: '删除对话失败' });
  }
});

// ==================== Helper Functions ====================

async function getLLMSettings() {
  const [settings] = await pool.query('SELECT * FROM settings');
  const settingsMap = {};
  settings.forEach(s => {
    settingsMap[s.setting_key] = s.setting_value;
  });
  return settingsMap;
}

async function getActivePrompt() {
  const [prompts] = await pool.query('SELECT * FROM prompts WHERE is_active = true LIMIT 1');
  return prompts.length > 0 ? prompts[0] : null;
}

const WIKI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'wiki');

// 列出 wiki 目录下所有 .md 文件（文件名即标题）
function listWikiFiles() {
  try {
    if (!fs.existsSync(WIKI_DIR)) return [];
    return fs.readdirSync(WIKI_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace(/\.md$/, ''));
  } catch {
    return [];
  }
}

// LLM Wiki 检索：调用 wiki_query.py（DeepSeek tool-call agent）
// 用 LLM tool-call 能力让模型自己搜索、读取 wiki 文件，带引用返回
async function searchKnowledge(query) {
  try {
    const scriptPath = path.join(WIKI_DIR, 'script', 'wiki_query.py');
    if (!fs.existsSync(scriptPath)) {
      console.error('[searchKnowledge] wiki_query.py 不存在');
      return { items: [], fallback: true };
    }

    const { execSync } = await import('child_process');
    const env = {
      ...process.env,
      WIKI_DIR: WIKI_DIR,
      LLM_ENDPOINT: 'https://api.deepseek.com/v1/chat/completions',
      LLM_MODEL: 'deepseek-v4-pro',
      LLM_API_KEY: process.env.DEEPSEEK_API_KEY || 'sk-1770fe3369ab47cb9dd4c5a0b4a2480a',
    };

    console.log(`[searchKnowledge] 调用 wiki_query.py: "${query.substring(0, 50)}"`);
    const output = execSync(
      `python3 "${scriptPath}" "${query.replace(/"/g, '\\"')}"`,
      { env, timeout: 120000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8' }
    );

    // wiki_query.py 输出的最终答案在 "═" 分隔线之间
    const answerMatch = output.match(/═{10,}\n([\s\S]*?)(?:\n═{10,}|$)/);
    const answer = answerMatch ? answerMatch[1].trim() : output.trim();

    if (!answer || answer === '(empty answer)') {
      console.log('[searchKnowledge] wiki_query 未找到相关内容');
      return { items: [], fallback: false };
    }

    console.log(`[searchKnowledge] wiki_query 返回 ${answer.length} 字符`);
    return {
      items: [{ title: 'Wiki 知识库检索结果', content: answer, knowledge_base_name: 'Wiki' }],
      fallback: false,
    };
  } catch (error) {
    console.error('Wiki search error:', error.message);
    return { items: [], fallback: true };
  }
}

// 意图分类：判断用户输入是闲聊还是需要检索工程知识库的问题
// 返回 true 表示需要查知识库，false 表示闲聊、直接调用大模型
// 意图分类：基于 wiki 文件标题关键词匹配，判断是否需要检索知识库
// 不用 LLM 做分类（DeepSeek reasoning 模式会把 token 耗在思考链上，分类不出结果）
function classifyQuery(message) {
  const titles = listWikiFiles();
  if (titles.length === 0) return false;

  const query = message.toLowerCase();

  // 从标题提取关键词（英文单词 + 中文 n-gram）
  function extractKeywords(title) {
    const keywords = new Set();
    const lower = title.toLowerCase();

    // 英文单词和数字
    const enWords = lower.match(/[a-z0-9]+/g) || [];
    enWords.forEach(w => w.length >= 2 && keywords.add(w));

    // 中文：2-gram（每2个连续字符）
    const cnChars = title.match(/[一-鿿]/g) || [];
    for (let i = 0; i <= cnChars.length - 2; i++) {
      keywords.add(cnChars[i] + cnChars[i + 1]);
    }

    return Array.from(keywords);
  }

  for (const title of titles) {
    const keywords = extractKeywords(title);
    for (const kw of keywords) {
      if (query.includes(kw)) {
        console.log(`[classifyQuery] 用户: "${message.substring(0, 30)}" → 匹配 wiki "${title}" 关键词 "${kw}" → 检索知识库`);
        return true;
      }
    }
  }

  console.log(`[classifyQuery] 用户: "${message.substring(0, 30)}" → 无匹配 wiki 标题 → 直接回复`);
  return false;
}

// Estimate token count (rough: ~4 chars per token for CJK, ~4 chars per token for English)
function estimateTokenCount(text) {
  return Math.ceil(text.length / 3);
}

// ==================== Chat Route (SSE with Qdrant RAG + Queue + Multi-turn) ====================

const MAX_HISTORY_MESSAGES = 20;
const MAX_CONTEXT_TOKENS = 8000;

app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { conversationId, message } = req.body;

    const [conversations] = await pool.query(
      'SELECT * FROM conversations WHERE id = ? AND user_id = ?',
      [conversationId, req.user.id]
    );

    if (conversations.length === 0) {
      return res.status(404).json({ error: '对话不存在' });
    }

    // Save user message
    await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
      [conversationId, 'user', message]
    );

    // Load conversation history
    const [allMessages] = await pool.query(
      'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    );

    const settings = await getLLMSettings();
    const activePrompt = await getActivePrompt();

    // 先做意图分类：仅当判定为知识库问题时才查 Qdrant，闲聊直接走大模型
    const needRetrieval = classifyQuery(message);

    let knowledgeItems = [];
    let ragFallback = false;
    if (needRetrieval) {
      try {
        const searchResult = await searchKnowledge(message);
        knowledgeItems = searchResult.items;
        ragFallback = searchResult.fallback;
      } catch (searchError) {
        console.error('Knowledge search error:', searchError);
        ragFallback = true;
      }
    }

    // Build system message
    let systemMessage = '';
    if (activePrompt) {
      systemMessage = activePrompt.content;
    }

    if (knowledgeItems.length > 0) {
      systemMessage += '\n\n以下是从知识库中检索到的相关信息，请参考这些信息来回答用户的问题：\n\n';
      knowledgeItems.forEach((item, index) => {
        systemMessage += `【知识 ${index + 1}】\n标题：${item.title}\n内容：${item.content}\n来源：${item.knowledge_base_name}\n\n`;
      });
    }

    // 追加代码生成指导
    systemMessage += CODE_GENERATION_PROMPT;

    // Multi-turn context management: limit history + token estimation
    let historyMessages = allMessages;
    if (historyMessages.length > MAX_HISTORY_MESSAGES) {
      historyMessages = historyMessages.slice(-MAX_HISTORY_MESSAGES);
    }

    // Token-aware truncation
    const maxTokens = parseInt(settings.llm_max_tokens) || 4096;
    const systemTokens = estimateTokenCount(systemMessage);
    let remainingTokens = MAX_CONTEXT_TOKENS - systemTokens;
    const truncatedMessages = [];

    // Add messages from newest to oldest, stop when token budget is exhausted
    for (let i = historyMessages.length - 1; i >= 0; i--) {
      const msgTokens = estimateTokenCount(historyMessages[i].content);
      if (remainingTokens - msgTokens < 0 && truncatedMessages.length > 0) {
        break;
      }
      remainingTokens -= msgTokens;
      truncatedMessages.unshift(historyMessages[i]);
    }

    const llmMessages = [];
    if (systemMessage) {
      llmMessages.push({ role: 'system', content: systemMessage });
    }
    llmMessages.push(...truncatedMessages);

    console.log(`[chat] activePrompt: ${activePrompt ? activePrompt.name : '无'} | needRetrieval: ${needRetrieval} | knowledgeItems: ${knowledgeItems.length} | systemMessage 长度: ${systemMessage.length} | 总消息数: ${llmMessages.length}`);
    if (systemMessage) {
      console.log(`[chat] systemMessage 内容: ${systemMessage.substring(0, 300)}`);
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send queue status to client
    const queueStatus = llmQueue.getStatus();
    if (queueStatus.pending > 0) {
      res.write(`data: ${JSON.stringify({ type: 'queue', ...queueStatus })}\n\n`);
    }

    // 仅当判定为知识库问题、且向量检索失败时提示用户（闲聊不检索，无提示）
    if (needRetrieval && ragFallback) {
      res.write(`data: ${JSON.stringify({ type: 'notice', message: '知识库检索失败，本次回答未参考知识库内容' })}\n\n`);
    }

    // Use LLM Queue for concurrency control
    await llmQueue.enqueue({}, async () => {
      const apiUrl = settings.llm_base_url;
      const tools = toolDefinitions;
      let fullResponse = '';

      // ---- Helper: stream an LLM call and accumulate fullResponse ----
      const streamLLMCall = async (messages, includTools) => {
        const body = {
          model: settings.llm_model,
          messages,
          stream: true,
          temperature: parseFloat(settings.llm_temperature) || 0.7,
          max_tokens: maxTokens,
          top_p: parseFloat(settings.llm_top_p) || 0.9
        };
        if (includTools) {
          body.tools = tools;
          body.tool_choice = 'auto';
        }

        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.llm_api_key}`
          },
          body: JSON.stringify(body)
        });

        if (!resp.ok) {
          const errorText = await resp.text().catch(() => '');
          console.error('LLM API error:', resp.status, errorText);
          throw new Error(`LLM API error: ${resp.status} ${errorText}`.trim());
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.trim());

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || '';

                if (content) {
                  fullResponse += content;
                  res.write(`data: ${JSON.stringify({ content })}\n\n`);
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
      };

      // ---- Phase 1: Non-streaming call to detect tool_calls ----
      const toolCallBody = {
        model: settings.llm_model,
        messages: llmMessages,
        stream: false,
        tools: tools,
        tool_choice: 'auto',
        temperature: parseFloat(settings.llm_temperature) || 0.7,
        max_tokens: maxTokens,
        top_p: parseFloat(settings.llm_top_p) || 0.9
      };

      const firstResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.llm_api_key}`
        },
        body: JSON.stringify(toolCallBody)
      });

      if (!firstResponse.ok) {
        const errorText = await firstResponse.text().catch(() => '');
        console.error('LLM API error:', firstResponse.status, errorText);
        throw new Error(`LLM API error: ${firstResponse.status} ${errorText}`.trim());
      }

      const firstResult = await firstResponse.json();
      const firstChoice = firstResult.choices?.[0];

      if (!firstChoice) {
        throw new Error('LLM returned empty choices');
      }

      let generatedPreview = false;
      let lastGeneratedFile = 'index.html';

      if (firstChoice.finish_reason === 'tool_calls' || firstChoice.message?.tool_calls?.length > 0) {
        // ---- Tool-call loop ----
        let toolCallMessages = [...llmMessages];
        let hasToolCalls = true;
        let iterations = 0;
        const maxIterations = 10;

        // Process the first tool-call response
        toolCallMessages.push(firstChoice.message);

        for (const toolCall of firstChoice.message.tool_calls) {
          res.write(`data: ${JSON.stringify({ type: 'tool_progress', tool: toolCall.function.name, status: 'running' })}\n\n`);
          try {
            const result = await executeToolCall(toolCall, conversationId.toString());
            if (toolCall.function.name === 'generate_code') {
              generatedPreview = true;
              try {
                const args = JSON.parse(toolCall.function.arguments);
                if (args.file_path) lastGeneratedFile = args.file_path;
              } catch (_) {}
            }
            toolCallMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result)
            });
            res.write(`data: ${JSON.stringify({ type: 'tool_progress', tool: toolCall.function.name, status: 'completed' })}\n\n`);
          } catch (err) {
            toolCallMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: err.message })
            });
            res.write(`data: ${JSON.stringify({ type: 'tool_progress', tool: toolCall.function.name, status: 'error' })}\n\n`);
          }
        }
        iterations++;

        // Continue loop: keep calling LLM until it stops returning tool_calls
        while (hasToolCalls && iterations < maxIterations) {
          iterations++;

          const loopBody = {
            model: settings.llm_model,
            messages: toolCallMessages,
            stream: false,
            tools: tools,
            tool_choice: 'auto',
            temperature: parseFloat(settings.llm_temperature) || 0.7,
            max_tokens: maxTokens,
            top_p: parseFloat(settings.llm_top_p) || 0.9
          };

          const loopResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${settings.llm_api_key}`
            },
            body: JSON.stringify(loopBody)
          });

          if (!loopResponse.ok) {
            const errorText = await loopResponse.text().catch(() => '');
            console.error('LLM API error (tool loop):', loopResponse.status, errorText);
            throw new Error(`LLM API error: ${loopResponse.status} ${errorText}`.trim());
          }

          const loopResult = await loopResponse.json();
          const loopChoice = loopResult.choices?.[0];

          if (!loopChoice) {
            hasToolCalls = false;
            break;
          }

          if (loopChoice.finish_reason === 'tool_calls' || loopChoice.message?.tool_calls?.length > 0) {
            toolCallMessages.push(loopChoice.message);

            for (const toolCall of loopChoice.message.tool_calls) {
              res.write(`data: ${JSON.stringify({ type: 'tool_progress', tool: toolCall.function.name, status: 'running' })}\n\n`);
              try {
                const result = await executeToolCall(toolCall, conversationId.toString());
                if (toolCall.function.name === 'generate_code') {
                  generatedPreview = true;
                  try {
                    const args = JSON.parse(toolCall.function.arguments);
                    if (args.file_path) lastGeneratedFile = args.file_path;
                  } catch (_) {}
                }
                toolCallMessages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(result)
                });
                res.write(`data: ${JSON.stringify({ type: 'tool_progress', tool: toolCall.function.name, status: 'completed' })}\n\n`);
              } catch (err) {
                toolCallMessages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({ error: err.message })
                });
                res.write(`data: ${JSON.stringify({ type: 'tool_progress', tool: toolCall.function.name, status: 'error' })}\n\n`);
              }
            }
          } else {
            // LLM returned text, no more tool_calls
            hasToolCalls = false;

            if (loopChoice.message?.content) {
              fullResponse = loopChoice.message.content;
              res.write(`data: ${JSON.stringify({ content: fullResponse })}\n\n`);
            }
          }
        }

        // If tool-call loop ended without a final text response, do a streaming call to get summary
        if (!fullResponse) {
          const finalBody = {
            model: settings.llm_model,
            messages: toolCallMessages,
            stream: true,
            temperature: parseFloat(settings.llm_temperature) || 0.7,
            max_tokens: maxTokens,
            top_p: parseFloat(settings.llm_top_p) || 0.9
          };

          const finalResp = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${settings.llm_api_key}`
            },
            body: JSON.stringify(finalBody)
          });

          if (!finalResp.ok) {
            const errorText = await finalResp.text().catch(() => '');
            throw new Error(`LLM API error: ${finalResp.status} ${errorText}`.trim());
          }

          const reader = finalResp.body.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim());

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content || '';

                  if (content) {
                    fullResponse += content;
                    res.write(`data: ${JSON.stringify({ content })}\n\n`);
                  }
                } catch (e) {
                  // Skip invalid JSON
                }
              }
            }
          }
        }

        // Send preview link if code was generated
        if (generatedPreview) {
          const previewUrl = `/preview/${conversationId}/${lastGeneratedFile}`;
          res.write(`data: ${JSON.stringify({ type: 'preview', url: previewUrl })}\n\n`);
        }
      } else {
        // ---- No tool_calls: plain text response → re-do as streaming ----
        // The first non-streaming call returned text. Stream it for consistent UX.
        await streamLLMCall(llmMessages, false);
      }

      // Save assistant response
      await pool.query(
        'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
        [conversationId, 'assistant', fullResponse]
      );

      // Auto-generate conversation title on first exchange
      if (allMessages.length <= 1) {
        const autoTitle = message.length > 20 ? message.substring(0, 20) + '...' : message;
        await pool.query(
          'UPDATE conversations SET title = ?, updated_at = NOW() WHERE id = ?',
          [autoTitle, conversationId]
        );
      } else {
        // Update conversation timestamp
        await pool.query(
          'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
          [conversationId]
        );
      }

      return fullResponse;
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Chat error:', error);
    res.write(`data: ${JSON.stringify({ error: '聊天失败：' + error.message })}\n\n`);
    res.end();
  }
});

// ==================== SPA Fallback ====================

// Serve React frontend for all non-API routes (SPA routing support)
app.get('*', (req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/api/')) {
    return next();
  }
  // Only handle HTML page requests (not static assets)
  if (!req.accepts('html')) {
    return next();
  }
  if (fs.existsSync(path.join(frontendDistPath, 'index.html'))) {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  } else {
    res.status(503).send(
      '<h1>Frontend not built</h1>' +
      '<p>Run: <code>cd frontend && npm install && npm run build</code></p>'
    );
  }
});

export default app;

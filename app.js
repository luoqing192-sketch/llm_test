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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize upload directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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

// ==================== Knowledge Base Routes ====================

app.get('/api/admin/knowledge-bases', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [bases] = await pool.query('SELECT * FROM knowledge_bases ORDER BY created_at DESC');

    for (const base of bases) {
      const [count] = await pool.query(
        'SELECT COUNT(*) as count FROM knowledge_items WHERE knowledge_base_id = ?',
        [base.id]
      );
      base.item_count = count[0].count;
    }

    res.json(bases);
  } catch (error) {
    res.status(500).json({ error: '获取知识库列表失败' });
  }
});

app.post('/api/admin/knowledge-bases', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, description = '' } = req.body;
    const [result] = await pool.query(
      'INSERT INTO knowledge_bases (name, description) VALUES (?, ?)',
      [name, description]
    );

    const [base] = await pool.query('SELECT * FROM knowledge_bases WHERE id = ?', [result.insertId]);
    res.json(base[0]);
  } catch (error) {
    console.error('Create knowledge base error:', error);
    res.status(500).json({ error: '创建知识库失败' });
  }
});

app.put('/api/admin/knowledge-bases/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    const baseId = req.params.id;

    await pool.query(
      'UPDATE knowledge_bases SET name = ?, description = ? WHERE id = ?',
      [name, description, baseId]
    );

    const [base] = await pool.query('SELECT * FROM knowledge_bases WHERE id = ?', [baseId]);
    res.json(base[0]);
  } catch (error) {
    res.status(500).json({ error: '更新知识库失败' });
  }
});

app.delete('/api/admin/knowledge-bases/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const baseId = req.params.id;
    await pool.query('DELETE FROM knowledge_bases WHERE id = ?', [baseId]);
    res.json({ message: '知识库已删除' });
  } catch (error) {
    res.status(500).json({ error: '删除知识库失败' });
  }
});

// ==================== Knowledge Items Routes (with Qdrant sync) ====================

app.get('/api/admin/knowledge-bases/:id/items', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const baseId = req.params.id;
    const [items] = await pool.query(
      'SELECT * FROM knowledge_items WHERE knowledge_base_id = ? ORDER BY created_at DESC',
      [baseId]
    );
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: '获取知识条目失败' });
  }
});

app.post('/api/admin/knowledge-bases/:id/items', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const baseId = req.params.id;
    const { title, content, keywords = '' } = req.body;

    const [result] = await pool.query(
      'INSERT INTO knowledge_items (knowledge_base_id, title, content, keywords) VALUES (?, ?, ?, ?)',
      [baseId, title, content, keywords]
    );

    const [item] = await pool.query('SELECT * FROM knowledge_items WHERE id = ?', [result.insertId]);
    const newItem = item[0];

    res.json(newItem);
  } catch (error) {
    console.error('Create knowledge item error:', error);
    res.status(500).json({ error: '创建知识条目失败' });
  }
});

app.put('/api/admin/knowledge-items/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, content, keywords } = req.body;
    const itemId = req.params.id;

    await pool.query(
      'UPDATE knowledge_items SET title = ?, content = ?, keywords = ? WHERE id = ?',
      [title, content, keywords, itemId]
    );

    const [item] = await pool.query('SELECT * FROM knowledge_items WHERE id = ?', [itemId]);
    const updatedItem = item[0];

    res.json(updatedItem);
  } catch (error) {
    res.status(500).json({ error: '更新知识条目失败' });
  }
});

app.delete('/api/admin/knowledge-items/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const itemId = req.params.id;
    await pool.query('DELETE FROM knowledge_items WHERE id = ?', [itemId]);
    res.json({ message: '知识条目已删除' });
  } catch (error) {
    res.status(500).json({ error: '删除知识条目失败' });
  }
});

// Knowledge search
app.get('/api/admin/knowledge/search', authenticateToken, async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.json([]);
    }

    const [items] = await pool.query(`
      SELECT ki.*, kb.name as knowledge_base_name
      FROM knowledge_items ki
      JOIN knowledge_bases kb ON ki.knowledge_base_id = kb.id
      WHERE ki.title LIKE ? OR ki.content LIKE ? OR ki.keywords LIKE ?
      LIMIT 20
    `, [`%${query}%`, `%${query}%`, `%${query}%`]);

    res.json(items);
  } catch (error) {
    console.error('Search knowledge error:', error);
    res.status(500).json({ error: '搜索知识库失败' });
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

// LLM Wiki 两步检索：
// 第一步：让 LLM 看文件标题列表，选出与问题相关的文件
// 第二步：读取选中文件的内容，作为知识上下文注入 prompt
async function searchKnowledge(query) {
  try {
    const titles = listWikiFiles();
    if (titles.length === 0) {
      return { items: [], fallback: false };
    }

    // 第一步：LLM 从标题列表中选择相关文件
    const settings = await getLLMSettings();
    const response = await fetch(settings.llm_base_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.llm_api_key}`,
      },
      body: JSON.stringify({
        model: settings.llm_model,
        stream: false,
        max_tokens: 200,
        messages: [
          {
            role: 'system',
            content:
              '你是一个知识库文件选择器。根据用户的问题，从下面的文件标题列表中选出可能包含相关信息的文件。' +
              '只返回文件标题，每行一个，不要加序号或其他标记。如果没有相关文件，返回空。\n\n' +
              '可用文件：\n' + titles.map(t => `- ${t}`).join('\n')
          },
          { role: 'user', content: query },
        ],
      }),
    });

    if (!response.ok) {
      console.error('Wiki file selection error:', response.status);
      return { items: [], fallback: true };
    }

    const data = await response.json();
    // 兼容 OpenAI/DeepSeek/Anthropic 多种响应格式
    const msg = data.choices?.[0]?.message;
    const llmAnswer = (
      msg?.content ||
      msg?.reasoning_content ||
      data.content?.[0]?.text ||
      ''
    ).trim();
    console.log(`[searchKnowledge] LLM 选择的文件: "${llmAnswer}"`);

    if (!llmAnswer) {
      return { items: [], fallback: false };
    }

    // 解析 LLM 返回的文件标题列表
    const selectedTitles = llmAnswer
      .split('\n')
      .map(line => line.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(t => t && titles.includes(t));

    if (selectedTitles.length === 0) {
      return { items: [], fallback: false };
    }

    // 第二步：读取选中文件的内容
    const items = selectedTitles.map(title => {
      const filePath = path.join(WIKI_DIR, `${title}.md`);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return { title, content, knowledge_base_name: 'Wiki' };
      } catch {
        return null;
      }
    }).filter(Boolean);

    return { items, fallback: false };
  } catch (error) {
    console.error('Wiki search error:', error);
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
      const response = await fetch(settings.llm_base_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.llm_api_key}`
        },
        body: JSON.stringify({
          model: settings.llm_model,
          messages: llmMessages,
          stream: true,
          temperature: parseFloat(settings.llm_temperature) || 0.7,
          max_tokens: maxTokens,
          top_p: parseFloat(settings.llm_top_p) || 0.9
        })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('LLM API error:', response.status, errorText);
        throw new Error(`LLM API error: ${response.status} ${errorText}`.trim());
      }

      let fullResponse = '';
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
                fullResponse += content;
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
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

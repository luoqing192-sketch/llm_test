import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from './db.js';
import { authenticateToken, requireAdmin } from './auth.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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
      { expiresIn: '7d' }
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

    const response = await fetch(`${settings.llm_base_url}/v1/chat/completions`, {
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
      throw new Error(`LLM API error: ${response.status}`);
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

// ==================== Knowledge Items Routes ====================

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
    res.json(item[0]);
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
    res.json(item[0]);
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
      WHERE MATCH(ki.title, ki.content, ki.keywords) AGAINST(? IN NATURAL LANGUAGE MODE)
      LIMIT 5
    `, [query]);

    res.json(items);
  } catch (error) {
    console.error('Search knowledge error:', error);
    res.status(500).json({ error: '搜索知识库失败' });
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
    const { title = '新对话' } = req.body;
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

// ==================== Helper: Get LLM Settings ====================

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

async function searchKnowledge(query) {
  const settings = await getLLMSettings();
  const limit = parseInt(settings.knowledge_retrieval_limit) || 3;
  const minScore = parseFloat(settings.knowledge_min_score) || 0.1;

  const [items] = await pool.query(`
    SELECT ki.*, kb.name as knowledge_base_name,
           MATCH(ki.title, ki.content, ki.keywords) AGAINST(? IN NATURAL LANGUAGE MODE) as relevance_score
    FROM knowledge_items ki
    JOIN knowledge_bases kb ON ki.knowledge_base_id = kb.id
    WHERE MATCH(ki.title, ki.content, ki.keywords) AGAINST(? IN NATURAL LANGUAGE MODE)
    HAVING relevance_score >= ?
    ORDER BY relevance_score DESC
    LIMIT ?
  `, [query, query, minScore, limit]);

  return items;
}

// ==================== Chat Route (SSE with Knowledge Retrieval) ====================

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

    await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
      [conversationId, 'user', message]
    );

    const [messages] = await pool.query(
      'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    );

    const settings = await getLLMSettings();
    const activePrompt = await getActivePrompt();

    // Search knowledge base
    const knowledgeItems = await searchKnowledge(message);
    
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

    const llmMessages = [];
    if (systemMessage) {
      llmMessages.push({ role: 'system', content: systemMessage });
    }
    llmMessages.push(...messages);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const response = await fetch(`${settings.llm_base_url}/v1/chat/completions`, {
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
        max_tokens: parseInt(settings.llm_max_tokens) || 4096,
        top_p: parseFloat(settings.llm_top_p) || 0.9
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('LLM API error:', response.status, errorText);
      throw new Error(`LLM API error: ${response.status}`);
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

    await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
      [conversationId, 'assistant', fullResponse]
    );

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Chat error:', error);
    res.write(`data: ${JSON.stringify({ error: '聊天失败：' + error.message })}\n\n`);
    res.end();
  }
});

// ==================== Start Server ====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

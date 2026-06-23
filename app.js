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
import { upsertVectors, searchSimilarVectors, deletePointsByFilter, qdrant } from './qdrant.js';
import { splitTextIntoChunks, extractTextFromBuffer } from './text-splitter.js';
import { getEmbedding } from './embeddings.js';
import { getEmbeddings } from './embeddings.js';
import llmQueue from './queue/llm-queue.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize upload directory
const uploadsDir = path.join(process.cwd(), 'uploads');
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
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Serve React frontend build
const frontendDistPath = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
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

    // Get knowledge base name for Qdrant payload
    const [bases] = await pool.query('SELECT name FROM knowledge_bases WHERE id = ?', [baseId]);
    const kbName = bases.length > 0 ? bases[0].name : '';

    // Sync to Qdrant: embed the content and upsert
    try {
      const textToEmbed = `${title}\n${content}${keywords ? '\n关键词: ' + keywords : ''}`;
      const embedding = await getEmbedding(textToEmbed);
      await upsertVectors([{
        id: `ki-${newItem.id}`,
        vector: embedding,
        payload: {
          knowledge_item_id: newItem.id,
          knowledge_base_id: parseInt(baseId),
          knowledge_base_name: kbName,
          title: title,
          content: content,
          keywords: keywords,
          type: 'knowledge_item',
        }
      }]);
    } catch (embedError) {
      console.error('Qdrant sync error (create item):', embedError);
      // Don't fail the request — item is saved in DB
    }

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

    // Sync to Qdrant: re-embed and upsert
    try {
      const [bases] = await pool.query(
        'SELECT kb.name FROM knowledge_bases kb JOIN knowledge_items ki ON ki.knowledge_base_id = kb.id WHERE ki.id = ?',
        [itemId]
      );
      const kbName = bases.length > 0 ? bases[0].name : '';

      const textToEmbed = `${title}\n${content}${keywords ? '\n关键词: ' + keywords : ''}`;
      const embedding = await getEmbedding(textToEmbed);
      await upsertVectors([{
        id: `ki-${itemId}`,
        vector: embedding,
        payload: {
          knowledge_item_id: parseInt(itemId),
          knowledge_base_id: updatedItem.knowledge_base_id,
          knowledge_base_name: kbName,
          title: title,
          content: content,
          keywords: keywords,
          type: 'knowledge_item',
        }
      }]);
    } catch (embedError) {
      console.error('Qdrant sync error (update item):', embedError);
    }

    res.json(updatedItem);
  } catch (error) {
    res.status(500).json({ error: '更新知识条目失败' });
  }
});

app.delete('/api/admin/knowledge-items/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const itemId = req.params.id;

    // Delete from Qdrant first
    try {
      await qdrant.delete('knowledge_vectors', {
        wait: true,
        points: [`ki-${itemId}`],
      });
    } catch (qdrantError) {
      console.error('Qdrant delete error:', qdrantError);
    }

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

// ==================== Document Management Routes ====================

// Upload document (admin only)
app.post('/api/admin/documents/upload', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }

    const { knowledge_base_id } = req.body;
    if (!knowledge_base_id) {
      return res.status(400).json({ error: '缺少知识库ID' });
    }

    // Save document record
    const [result] = await pool.query(
      'INSERT INTO documents (filename, original_name, file_path, file_size, knowledge_base_id, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
      [req.file.filename, req.file.originalname, req.file.path, req.file.size, knowledge_base_id, req.user.id]
    );

    const documentId = result.insertId;

    // Process document asynchronously
    processDocument(documentId, req.file.path, knowledge_base_id).catch(error => {
      console.error('Document processing error:', error);
      pool.query(
        'UPDATE documents SET status = ?, error_message = ? WHERE id = ?',
        ['failed', error.message, documentId]
      );
    });

    res.json({
      message: '文件上传成功，正在处理',
      document_id: documentId
    });
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ error: '上传文档失败' });
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

// Get documents by knowledge base
app.get('/api/admin/knowledge-bases/:id/documents', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const baseId = req.params.id;
    const [documents] = await pool.query(
      'SELECT * FROM documents WHERE knowledge_base_id = ? ORDER BY uploaded_at DESC',
      [baseId]
    );
    res.json(documents);
  } catch (error) {
    res.status(500).json({ error: '获取文档列表失败' });
  }
});

// Delete document
app.delete('/api/admin/documents/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const docId = req.params.id;

    // Get document info
    const [docs] = await pool.query('SELECT * FROM documents WHERE id = ?', [docId]);
    if (docs.length === 0) {
      return res.status(404).json({ error: '文档不存在' });
    }

    const doc = docs[0];

    // Delete chunks and their vectors from Qdrant
    const [chunks] = await pool.query('SELECT vector_id FROM document_chunks WHERE document_id = ?', [docId]);
    for (const chunk of chunks) {
      if (chunk.vector_id) {
        await qdrant.delete('knowledge_vectors', {
          wait: true,
          points: [chunk.vector_id]
        });
      }
    }

    // Delete document record (cascades to chunks)
    await pool.query('DELETE FROM documents WHERE id = ?', [docId]);

    // Delete physical file
    if (doc.file_path) {
      try {
        fs.unlinkSync(doc.file_path);
      } catch (e) {
        console.error('Delete file error:', e);
      }
    }

    res.json({ message: '文档已删除' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: '删除文档失败' });
  }
});

// Process document: read, split, embed, store in Qdrant (enhanced with metadata)
async function processDocument(documentId, filePath, knowledgeBaseId) {
  try {
    // Update status to processing
    await pool.query('UPDATE documents SET status = ? WHERE id = ?', ['processing', documentId]);

    // Get document info and knowledge base name
    const [docs] = await pool.query('SELECT * FROM documents WHERE id = ?', [documentId]);
    const doc = docs[0];

    let kbName = '';
    if (knowledgeBaseId) {
      const [bases] = await pool.query('SELECT name FROM knowledge_bases WHERE id = ?', [knowledgeBaseId]);
      kbName = bases.length > 0 ? bases[0].name : '';
    }

    // Read file content
    const content = fs.readFileSync(filePath, 'utf-8');

    // Split into chunks
    const chunks = splitTextIntoChunks(content);

    // Generate embeddings for each chunk
    const embeddings = await getEmbeddings(chunks);

    // Store in Qdrant with enhanced metadata
    const points = embeddings.map((embedding, index) => ({
      id: `${documentId}-${index}`,
      vector: embedding,
      payload: {
        document_id: documentId,
        chunk_index: index,
        content: chunks[index],
        title: doc ? doc.original_name : '',
        knowledge_base_id: knowledgeBaseId ? parseInt(knowledgeBaseId) : null,
        knowledge_base_name: kbName,
        type: 'document',
      }
    }));

    // Batch upsert to Qdrant
    const batchSize = 100;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      await upsertVectors(batch);
    }

    // Save chunks to database
    for (let i = 0; i < chunks.length; i++) {
      await pool.query(
        'INSERT INTO document_chunks (document_id, chunk_index, content, vector_id) VALUES (?, ?, ?, ?)',
        [documentId, i, chunks[i], `${documentId}-${i}`]
      );
    }

    // Update status to completed
    await pool.query('UPDATE documents SET status = ? WHERE id = ?', ['completed', documentId]);

    console.log(`Document ${documentId} processed successfully: ${chunks.length} chunks`);
  } catch (error) {
    console.error('Process document error:', error);
    await pool.query(
      'UPDATE documents SET status = ?, error_message = ? WHERE id = ?',
      ['failed', error.message, documentId]
    );
    throw error;
  }
}

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

// RAG: Search knowledge using Qdrant vector similarity
async function searchKnowledge(query) {
  const settings = await getLLMSettings();
  const limit = parseInt(settings.knowledge_retrieval_limit) || 3;
  const minScore = parseFloat(settings.knowledge_min_score) || 0.7;

  try {
    // 1. Embed the query text
    const queryVector = await getEmbedding(query);

    // 2. Search Qdrant for similar vectors
    const results = await searchSimilarVectors(queryVector, limit, minScore);

    // 3. Map results to knowledge item format
    return results.map(r => ({
      title: r.payload?.title || (r.payload?.content || '').substring(0, 50),
      content: r.payload?.content || '',
      knowledge_base_name: r.payload?.knowledge_base_name || '知识库',
      relevance_score: r.score,
    }));
  } catch (error) {
    console.error('Qdrant search error, falling back to MySQL FULLTEXT:', error);
    // Fallback to MySQL FULLTEXT search
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

    // Search knowledge base via Qdrant vector similarity
    let knowledgeItems = [];
    try {
      knowledgeItems = await searchKnowledge(message);
    } catch (searchError) {
      console.error('Knowledge search error:', searchError);
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

    // Use LLM Queue for concurrency control
    await llmQueue.enqueue({}, async () => {
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
          max_tokens: maxTokens,
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
if (fs.existsSync(frontendDistPath)) {
  app.get('*', (req, res, next) => {
    // Skip API routes and static files
    if (req.path.startsWith('/api/') || req.path.includes('.')) {
      return next();
    }
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

export default app;

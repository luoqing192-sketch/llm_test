const API_BASE = '';
let token = localStorage.getItem('token');
let currentUser = null;
let currentConversationId = null;
let conversations = [];
let currentKnowledgeBaseId = null;

// ==================== Initialization ====================

async function init() {
  if (token) {
    await loadCurrentUser();
    if (currentUser) {
      showChatPage();
      await loadConversations();
    } else {
      showLoginPage();
    }
  } else {
    showLoginPage();
  }
}

// ==================== Auth ====================

async function login(username, password) {
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || '登录失败');
  }

  token = data.token;
  localStorage.setItem('token', token);
  currentUser = data.user;
}

async function loadCurrentUser() {
  try {
    const response = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('获取用户信息失败');
    }

    currentUser = await response.json();
  } catch (error) {
    token = null;
    localStorage.removeItem('token');
    currentUser = null;
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  showLoginPage();
}

// ==================== UI Navigation ====================

function showLoginPage() {
  document.getElementById('login-page').classList.remove('hidden');
  document.getElementById('chat-page').classList.add('hidden');
}

function showChatPage() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('chat-page').classList.remove('hidden');
  document.getElementById('user-name').textContent = currentUser.username;
  
  if (currentUser.role === 'admin') {
    document.getElementById('admin-panel').classList.remove('hidden');
  } else {
    document.getElementById('admin-panel').classList.add('hidden');
  }
}

function showWelcomeScreen() {
  document.getElementById('welcome-screen').classList.remove('hidden');
  document.getElementById('chat-view').classList.add('hidden');
  currentConversationId = null;
  updateConversationList();
}

function showChatView() {
  document.getElementById('welcome-screen').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');
}

// ==================== Conversations ====================

async function loadConversations() {
  try {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('加载对话列表失败');
    }

    conversations = await response.json();
    updateConversationList();
  } catch (error) {
    console.error('Error loading conversations:', error);
    alert('加载对话列表失败');
  }
}

function updateConversationList() {
  const list = document.getElementById('conversations-list');
  
  if (conversations.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: rgba(255,255,255,0.5); padding: 2rem;">暂无对话</p>';
    return;
  }

  list.innerHTML = conversations.map(conv => `
    <div class="conversation-item ${conv.id === currentConversationId ? 'active' : ''}" data-id="${conv.id}">
      <span>${escapeHtml(conv.title)}</span>
      <button onclick="deleteConversation(${conv.id}, event)" title="删除此对话">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  `).join('');

  list.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
        const id = parseInt(item.dataset.id);
        openConversation(id);
      }
    });
  });
}

function createConversation() {
  // Just show empty chat view, don't create in database yet
  currentConversationId = null;
  document.getElementById('conversation-title').textContent = '新对话';
  document.getElementById('messages-container').innerHTML = '';
  showChatView();
  updateConversationList();
  document.getElementById('message-input').focus();
}

async function openConversation(id) {
  currentConversationId = id;
  const conversation = conversations.find(c => c.id === id);
  
  if (!conversation) return;

  document.getElementById('conversation-title').textContent = conversation.title;
  showChatView();
  updateConversationList();
  await loadMessages(id);
}

async function loadMessages(conversationId) {
  try {
    const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/messages`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('加载消息失败');
    }

    const messages = await response.json();
    renderMessages(messages);
  } catch (error) {
    console.error('Error loading messages:', error);
    alert('加载消息失败');
  }
}

function renderMessages(messages) {
  const container = document.getElementById('messages-container');
  container.innerHTML = messages.map(msg => `
    <div class="message ${msg.role}">
      ${escapeHtml(msg.content)}
    </div>
  `).join('');
  
  container.scrollTop = container.scrollHeight;
}

async function deleteConversation(id, event) {
  event.stopPropagation();
  
  const conv = conversations.find(c => c.id === id);
  const title = conv ? conv.title : '此对话';
  
  showConfirmDialog(
    '删除对话',
    `确定要删除「${title}」吗？此操作不可撤销。`,
    'fas fa-trash-alt',
    async () => {
      try {
        const response = await fetch(`${API_BASE}/api/conversations/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
          throw new Error('删除对话失败');
        }

        conversations = conversations.filter(c => c.id !== id);
        
        if (currentConversationId === id) {
          showWelcomeScreen();
        }
        
        updateConversationList();
        showToast('对话已删除', 'success');
      } catch (error) {
        console.error('Error deleting conversation:', error);
        showToast('删除对话失败', 'error');
      }
    }
  );
}

  try {
    const response = await fetch(`${API_BASE}/api/conversations/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('删除对话失败');
    }

    conversations = conversations.filter(c => c.id !== id);
    
    if (currentConversationId === id) {
      showWelcomeScreen();
    }
    
    updateConversationList();
  } catch (error) {
    console.error('Error deleting conversation:', error);
    alert('删除对话失败');
  }
}

// ==================== Chat ====================

async function sendMessage() {
  const input = document.getElementById('message-input');
  const message = input.value.trim();
  
  if (!message) return;

  // If no current conversation, create one first
  if (!currentConversationId) {
    try {
      // Use first 20 characters of message as title
      const title = message.length > 20 ? message.substring(0, 20) + '...' : message;
      const response = await fetch(`${API_BASE}/api/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title })
      });

      if (!response.ok) {
        throw new Error('创建对话失败');
      }

      const conversation = await response.json();
      conversations.unshift(conversation);
      currentConversationId = conversation.id;
      document.getElementById('conversation-title').textContent = conversation.title;
      updateConversationList();
    } catch (error) {
      console.error('Error creating conversation:', error);
      showToast('创建对话失败', 'error');
      return;
    }
  }

  input.value = '';
  input.style.height = 'auto';

  const container = document.getElementById('messages-container');
  const userMessageDiv = document.createElement('div');
  userMessageDiv.className = 'message user';
  userMessageDiv.textContent = message;
  container.appendChild(userMessageDiv);
  container.scrollTop = container.scrollHeight;

  const assistantMessageDiv = document.createElement('div');
  assistantMessageDiv.className = 'message assistant streaming';
  assistantMessageDiv.textContent = '';
  container.appendChild(assistantMessageDiv);

  input.disabled = true;
  document.getElementById('send-btn').disabled = true;

  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        conversationId: currentConversationId,
        message: message
      })
    });

    if (!response.ok) {
      throw new Error('发送消息失败');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            
            if (parsed.error) {
              throw new Error(parsed.error);
            }

            if (parsed.content) {
              fullContent += parsed.content;
              assistantMessageDiv.textContent = fullContent;
              container.scrollTop = container.scrollHeight;
            }
          } catch (e) {
            if (e.message !== 'Unexpected end of JSON input') {
              throw e;
            }
          }
        }
      }
    }

    assistantMessageDiv.classList.remove('streaming');

  } catch (error) {
    console.error('Error sending message:', error);
    assistantMessageDiv.textContent = '发送失败，请重试';
    assistantMessageDiv.classList.remove('streaming');
  } finally {
    input.disabled = false;
    document.getElementById('send-btn').disabled = false;
    input.focus();
  }
}

// ==================== Admin Functions ====================

function showAdminModal() {
  document.getElementById('admin-modal').classList.remove('hidden');
  switchTab('users');
  loadUsers();
}

function hideAdminModal() {
  document.getElementById('admin-modal').classList.add('hidden');
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');
  
  if (tabName === 'llm') {
    loadLLMSettings();
  } else if (tabName === 'prompts') {
    loadPrompts();
  } else if (tabName === 'knowledge') {
    loadKnowledgeBases();
  } else if (tabName === 'users') {
    loadUsers();
  }
}

// ==================== Users Management ====================

async function loadUsers() {
  try {
    const response = await fetch(`${API_BASE}/api/admin/users`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('加载用户列表失败');
    }

    const users = await response.json();
    renderUsersTable(users);
  } catch (error) {
    console.error('Error loading users:', error);
    alert('加载用户列表失败');
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-table-body');
  tbody.innerHTML = users.map(user => `
    <tr>
      <td>${escapeHtml(user.username)}</td>
      <td>${user.role === 'admin' ? '管理员' : '普通用户'}</td>
      <td>${new Date(user.created_at).toLocaleString('zh-CN')}</td>
      <td>
        <button class="btn-edit" onclick="editUser(${user.id}, '${escapeHtml(user.username)}', '${user.role}')">
          <i class="fas fa-edit"></i>
        </button>
        ${user.id !== currentUser.id ? `
          <button class="btn-delete" onclick="deleteUser(${user.id})">
            <i class="fas fa-trash"></i>
          </button>
        ` : ''}
      </td>
    </tr>
  `).join('');
}

function showUserFormModal(userId = null, username = '', role = 'user') {
  document.getElementById('user-form-modal').classList.remove('hidden');
  document.getElementById('user-form-id').value = userId || '';
  document.getElementById('user-form-username').value = username;
  document.getElementById('user-form-password').value = '';
  document.getElementById('user-form-role').value = role;
  document.getElementById('user-form-title').textContent = userId ? '编辑用户' : '创建用户';
  document.getElementById('user-form-username').disabled = !!userId;
}

function hideUserFormModal() {
  document.getElementById('user-form-modal').classList.add('hidden');
}

async function saveUser(event) {
  event.preventDefault();
  
  const userId = document.getElementById('user-form-id').value;
  const username = document.getElementById('user-form-username').value;
  const password = document.getElementById('user-form-password').value;
  const role = document.getElementById('user-form-role').value;

  try {
    if (userId) {
      const response = await fetch(`${API_BASE}/api/admin/users/${userId}/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        throw new Error('更新用户失败');
      }
    } else {
      const response = await fetch(`${API_BASE}/api/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ username, password, role })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '创建用户失败');
      }
    }

    hideUserFormModal();
    showToast('用户已保存', 'success');
    await loadUsers();
  } catch (error) {
    console.error('Error saving user:', error);
    showToast(error.message, 'error');
  }
}

function editUser(userId, username, role) {
  showUserFormModal(userId, username, role);
}

async function deleteUser(userId) {
  if (!confirm('确定要删除这个用户吗？')) return;

  try {
    const response = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || '删除用户失败');
    }

    await loadUsers();
  } catch (error) {
    console.error('Error deleting user:', error);
    alert(error.message);
  }
}

// ==================== LLM Settings ====================

async function loadLLMSettings() {
  try {
    const response = await fetch(`${API_BASE}/api/admin/settings`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('加载设置失败');
    }

    const settings = await response.json();
    
    document.getElementById('llm_base_url').value = settings.llm_base_url || '';
    document.getElementById('llm_api_key').value = settings.llm_api_key || '';
    document.getElementById('llm_model').value = settings.llm_model || '';
    document.getElementById('llm_temperature').value = settings.llm_temperature || '0.7';
    document.getElementById('llm_max_tokens').value = settings.llm_max_tokens || '4096';
    document.getElementById('llm_top_p').value = settings.llm_top_p || '0.9';
    document.getElementById('knowledge_retrieval_limit').value = settings.knowledge_retrieval_limit || '3';
    document.getElementById('knowledge_min_score').value = settings.knowledge_min_score || '0.1';
  } catch (error) {
    console.error('Error loading settings:', error);
    alert('加载设置失败');
  }
}

async function saveLLMSettings(event) {
  event.preventDefault();
  
  const settings = {
    llm_base_url: document.getElementById('llm_base_url').value,
    llm_api_key: document.getElementById('llm_api_key').value,
    llm_model: document.getElementById('llm_model').value,
    llm_temperature: document.getElementById('llm_temperature').value,
    llm_max_tokens: document.getElementById('llm_max_tokens').value,
    llm_top_p: document.getElementById('llm_top_p').value,
    knowledge_retrieval_limit: document.getElementById('knowledge_retrieval_limit').value,
    knowledge_min_score: document.getElementById('knowledge_min_score').value
  };

  try {
    const response = await fetch(`${API_BASE}/api/admin/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(settings)
    });

    if (!response.ok) {
      throw new Error('保存设置失败');
    }

    showToast('设置已保存', 'success');
    hideAdminModal();
  } catch (error) {
    console.error('Error saving settings:', error);
    alert('保存设置失败');
  }
}

// ==================== Prompts Management ====================

async function loadPrompts() {
  try {
    const response = await fetch(`${API_BASE}/api/admin/prompts`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('加载提示词列表失败');
    }

    const prompts = await response.json();
    renderPromptsList(prompts);
    
    // Load active prompt
    await loadActivePrompt();
  } catch (error) {
    console.error('Error loading prompts:', error);
    alert('加载提示词列表失败');
  }
}

async function loadActivePrompt() {
  try {
    const response = await fetch(`${API_BASE}/api/admin/prompts/active`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('获取激活提示词失败');
    }

    const activePrompt = await response.json();
    const activePromptNameEl = document.getElementById('active-prompt-name');
    if (activePromptNameEl) {
      activePromptNameEl.textContent = activePrompt ? activePrompt.name : '无';
    }
  } catch (error) {
    console.error('Error loading active prompt:', error);
  }
}

function renderPromptsList(prompts) {
  const list = document.getElementById('prompts-list');
  
  if (prompts.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">暂无提示词</p>';
    return;
  }

  list.innerHTML = prompts.map(prompt => `
    <div class="card">
      <div class="card-header">
        <div class="card-title">${escapeHtml(prompt.name)}</div>
        ${prompt.is_active ? '<span class="card-badge">激活</span>' : ''}
      </div>
      <div class="card-description">${escapeHtml(prompt.description || '')}</div>
      <div class="card-meta">
        <span>创建于: ${new Date(prompt.created_at).toLocaleString('zh-CN')}</span>
      </div>
      <div class="card-actions">
        ${prompt.is_active ? `
          <button class="btn-secondary" onclick="deactivatePrompt(${prompt.id})">
            <i class="fas fa-pause"></i> 停用
          </button>
        ` : `
          <button class="btn-activate" onclick="activatePrompt(${prompt.id})">
            <i class="fas fa-check"></i> 激活
          </button>
        `}
        <button class="btn-edit" onclick="editPrompt(${prompt.id}, '${escapeHtml(prompt.name)}', '${escapeHtml(prompt.description)}', ${prompt.is_active}, \`${escapeHtml(prompt.content).replace(/`/g, '\\`')}\`)">
          <i class="fas fa-edit"></i> 编辑
        </button>
        <button class="btn-delete" onclick="deletePrompt(${prompt.id})">
          <i class="fas fa-trash"></i> 删除
        </button>
      </div>
    </div>
  `).join('');
}

function showPromptFormModal(promptId = null, name = '', description = '', isActive = false, content = '') {
  document.getElementById('prompt-form-modal').classList.remove('hidden');
  document.getElementById('prompt-form-id').value = promptId || '';
  document.getElementById('prompt-form-name').value = name;
  document.getElementById('prompt-form-description').value = description;
  document.getElementById('prompt-form-content').value = content;
  document.getElementById('prompt-form-active').checked = isActive;
  document.getElementById('prompt-form-title').textContent = promptId ? '编辑提示词' : '创建提示词';
}

function hidePromptFormModal() {
  document.getElementById('prompt-form-modal').classList.add('hidden');
}

async function savePrompt(event) {
  event.preventDefault();
  
  const promptId = document.getElementById('prompt-form-id').value;
  const name = document.getElementById('prompt-form-name').value;
  const description = document.getElementById('prompt-form-description').value;
  const content = document.getElementById('prompt-form-content').value;
  const is_active = document.getElementById('prompt-form-active').checked;

  try {
    if (promptId) {
      const response = await fetch(`${API_BASE}/api/admin/prompts/${promptId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, description, content, is_active })
      });

      if (!response.ok) {
        throw new Error('更新提示词失败');
      }
    } else {
      const response = await fetch(`${API_BASE}/api/admin/prompts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, description, content, is_active })
      });

      if (!response.ok) {
        throw new Error('创建提示词失败');
      }
    }

    hidePromptFormModal();
    showToast('提示词已保存', 'success');
    await loadPrompts();
  } catch (error) {
    console.error('Error saving prompt:', error);
    showToast(error.message, 'error');
  }
}

function editPrompt(promptId, name, description, isActive, content) {
  showPromptFormModal(promptId, name, description, isActive, content);
}

async function activatePrompt(promptId) {
  try {
    const response = await fetch(`${API_BASE}/api/admin/prompts/${promptId}/activate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('激活提示词失败');
    }

    await loadPrompts();
  } catch (error) {
    console.error('Error activating prompt:', error);
    alert('激活提示词失败');
  }
}

async function deactivatePrompt(promptId) {
  try {
    const response = await fetch(`${API_BASE}/api/admin/prompts/${promptId}/deactivate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('停用提示词失败');
    }

    await loadPrompts();
  } catch (error) {
    console.error('Error deactivating prompt:', error);
    alert('停用提示词失败');
  }
}

function showPromptTestModal() {
  document.getElementById('prompt-test-modal').classList.remove('hidden');
  document.getElementById('prompt-test-content').value = '';
  document.getElementById('prompt-test-message').value = '';
  document.getElementById('prompt-test-result').classList.add('hidden');
  document.getElementById('prompt-test-output').textContent = '';
}

function hidePromptTestModal() {
  document.getElementById('prompt-test-modal').classList.add('hidden');
}

async function runPromptTest() {
  const promptContent = document.getElementById('prompt-test-content').value;
  const testMessage = document.getElementById('prompt-test-message').value;
  
  if (!promptContent || !testMessage) {
    alert('请填写提示词内容和测试消息');
    return;
  }

  const resultDiv = document.getElementById('prompt-test-result');
  const outputDiv = document.getElementById('prompt-test-output');
  const runBtn = document.getElementById('run-test-btn');

  resultDiv.classList.remove('hidden');
  outputDiv.textContent = '正在测试...';
  runBtn.disabled = true;

  try {
    const response = await fetch(`${API_BASE}/api/admin/prompts/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ promptContent, testMessage })
    });

    if (!response.ok) {
      throw new Error('测试请求失败');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';

    outputDiv.textContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            
            if (parsed.error) {
              throw new Error(parsed.error);
            }

            if (parsed.content) {
              fullResponse += parsed.content;
              outputDiv.textContent = fullResponse;
            }
          } catch (e) {
            if (e.message !== 'Unexpected end of JSON input' && !e.message.includes('JSON')) {
              throw e;
            }
          }
        }
      }
    }

  } catch (error) {
    console.error('Error running prompt test:', error);
    outputDiv.textContent = '测试失败：' + error.message;
  } finally {
    runBtn.disabled = false;
  }
}

async function deletePrompt(promptId) {
  if (!confirm('确定要删除这个提示词吗？')) return;

  try {
    const response = await fetch(`${API_BASE}/api/admin/prompts/${promptId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('删除提示词失败');
    }

    await loadPrompts();
  } catch (error) {
    console.error('Error deleting prompt:', error);
    alert('删除提示词失败');
  }
}

// ==================== Document Management ====================

async function loadDocuments(knowledgeBaseId) {
  try {
    const response = await fetch(`${API_BASE}/api/admin/knowledge-bases/${knowledgeBaseId}/documents`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('加载文档列表失败');
    }

    const documents = await response.json();
    renderDocumentsTable(documents);
  } catch (error) {
    console.error('Error loading documents:', error);
    showToast('加载文档列表失败', 'error');
  }
}

function renderDocumentsTable(documents) {
  const tbody = document.getElementById('documents-table-body');
  
  if (!documents || documents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 2rem;">暂无文档</td></tr>';
    return;
  }

  tbody.innerHTML = documents.map(doc => `
    <tr>
      <td>${escapeHtml(doc.filename)}</td>
      <td>${formatFileSize(doc.file_size)}</td>
      <td>
        <span class="status-badge status-${doc.status}">${getStatusText(doc.status)}</span>
      </td>
      <td>${new Date(doc.created_at).toLocaleString('zh-CN')}</td>
      <td>
        <button class="btn-delete" onclick="deleteDocument(${doc.id})">
          <i class="fas fa-trash"></i> 删除
        </button>
      </td>
    </tr>
  `).join('');
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function getStatusText(status) {
  const statusMap = {
    'pending': '待处理',
    'processing': '处理中',
    'completed': '已完成',
    'failed': '失败'
  };
  return statusMap[status] || status;
}

async function uploadDocuments(files, knowledgeBaseId) {
  const formData = new FormData();
  formData.append('knowledge_base_id', knowledgeBaseId);
  
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }

  try {
    const response = await fetch(`${API_BASE}/api/admin/documents/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    if (!response.ok) {
      throw new Error('上传文档失败');
    }

    const result = await response.json();
    showToast(result.message, 'success');
    
    // Reload documents list
    await loadDocuments(knowledgeBaseId);
  } catch (error) {
    console.error('Error uploading documents:', error);
    showToast('上传文档失败: ' + error.message, 'error');
  }
}

async function deleteDocument(documentId) {
  showConfirmDialog('删除文档', '确定要删除此文档吗？相关的所有知识条目也会被删除。', async () => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/documents/${documentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('删除文档失败');
      }

      showToast('文档已删除', 'success');
      
      // Reload documents list
      if (currentKnowledgeBaseId) {
        await loadDocuments(currentKnowledgeBaseId);
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      showToast('删除文档失败: ' + error.message, 'error');
    }
  });
}

// ==================== Knowledge Base Management ====================

async function loadKnowledgeBases() {
  try {
    const response = await fetch(`${API_BASE}/api/admin/knowledge-bases`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('加载知识库列表失败');
    }

    const bases = await response.json();
    renderKnowledgeBasesList(bases);
  } catch (error) {
    console.error('Error loading knowledge bases:', error);
    alert('加载知识库列表失败');
  }
}

function renderKnowledgeBasesList(bases) {
  const list = document.getElementById('knowledge-bases-list');
  
  if (bases.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">暂无知识库</p>';
    return;
  }

  list.innerHTML = bases.map(base => `
    <div class="card">
      <div class="card-header">
        <div class="card-title">${escapeHtml(base.name)}</div>
      </div>
      <div class="card-description">${escapeHtml(base.description || '')}</div>
      <div class="card-meta">
        <span>条目数: ${base.item_count}</span>
        <span>创建于: ${new Date(base.created_at).toLocaleString('zh-CN')}</span>
      </div>
      <div class="card-actions">
        <button class="btn-view" onclick="viewKnowledgeBase(${base.id}, '${escapeHtml(base.name)}')">
          <i class="fas fa-eye"></i> 查看
        </button>
        <button class="btn-edit" onclick="editKnowledgeBase(${base.id}, '${escapeHtml(base.name)}', '${escapeHtml(base.description)}')">
          <i class="fas fa-edit"></i> 编辑
        </button>
        <button class="btn-delete" onclick="deleteKnowledgeBase(${base.id})">
          <i class="fas fa-trash"></i> 删除
        </button>
      </div>
    </div>
  `).join('');
}

function showKnowledgeBaseFormModal(baseId = null, name = '', description = '') {
  document.getElementById('knowledge-base-form-modal').classList.remove('hidden');
  document.getElementById('knowledge-base-form-id').value = baseId || '';
  document.getElementById('knowledge-base-form-name').value = name;
  document.getElementById('knowledge-base-form-description').value = description;
  document.getElementById('knowledge-base-form-title').textContent = baseId ? '编辑知识库' : '创建知识库';
}

function hideKnowledgeBaseFormModal() {
  document.getElementById('knowledge-base-form-modal').classList.add('hidden');
}

async function saveKnowledgeBase(event) {
  event.preventDefault();
  
  const baseId = document.getElementById('knowledge-base-form-id').value;
  const name = document.getElementById('knowledge-base-form-name').value;
  const description = document.getElementById('knowledge-base-form-description').value;

  try {
    if (baseId) {
      const response = await fetch(`${API_BASE}/api/admin/knowledge-bases/${baseId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, description })
      });

      if (!response.ok) {
        throw new Error('更新知识库失败');
      }
    } else {
      const response = await fetch(`${API_BASE}/api/admin/knowledge-bases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, description })
      });

      if (!response.ok) {
        throw new Error('创建知识库失败');
      }
    }

    hideKnowledgeBaseFormModal();
    showToast('知识库已保存', 'success');
    await loadKnowledgeBases();
  } catch (error) {
    console.error('Error saving knowledge base:', error);
    showToast(error.message, 'error');
  }
}

function editKnowledgeBase(baseId, name, description) {
  showKnowledgeBaseFormModal(baseId, name, description);
}

async function deleteKnowledgeBase(baseId) {
  if (!confirm('确定要删除这个知识库吗？所有知识条目也会被删除。')) return;

  try {
    const response = await fetch(`${API_BASE}/api/admin/knowledge-bases/${baseId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('删除知识库失败');
    }

    await loadKnowledgeBases();
  } catch (error) {
    console.error('Error deleting knowledge base:', error);
    alert('删除知识库失败');
  }
}

async function viewKnowledgeBase(baseId, name) {
  currentKnowledgeBaseId = baseId;
  document.getElementById('knowledge-base-title').textContent = name;
  document.getElementById('knowledge-bases-list').classList.add('hidden');
  document.getElementById('knowledge-items-panel').classList.remove('hidden');
  await loadKnowledgeItems(baseId);
  await loadDocuments(baseId);
}

function backToKnowledgeBases() {
  currentKnowledgeBaseId = null;
  document.getElementById('knowledge-bases-list').classList.remove('hidden');
  document.getElementById('knowledge-items-panel').classList.add('hidden');
}

async function loadKnowledgeItems(baseId) {
  try {
    const response = await fetch(`${API_BASE}/api/admin/knowledge-bases/${baseId}/items`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('加载知识条目失败');
    }

    const items = await response.json();
    renderKnowledgeItemsTable(items);
  } catch (error) {
    console.error('Error loading knowledge items:', error);
    alert('加载知识条目失败');
  }
}

function renderKnowledgeItemsTable(items) {
  const tbody = document.getElementById('knowledge-items-table-body');
  
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary); padding: 2rem;">暂无知识条目</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(item => `
    <tr>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.keywords || '')}</td>
      <td>${new Date(item.created_at).toLocaleString('zh-CN')}</td>
      <td>
        <button class="btn-edit" onclick="editKnowledgeItem(${item.id}, ${item.knowledge_base_id}, '${escapeHtml(item.title)}', '${escapeHtml(item.keywords)}', \`${escapeHtml(item.content).replace(/`/g, '\\`')}\`)">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-delete" onclick="deleteKnowledgeItem(${item.id})">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

function showKnowledgeItemFormModal(itemId = null, baseId = null, title = '', keywords = '', content = '') {
  document.getElementById('knowledge-item-form-modal').classList.remove('hidden');
  document.getElementById('knowledge-item-form-id').value = itemId || '';
  document.getElementById('knowledge-item-form-base-id').value = baseId || currentKnowledgeBaseId;
  document.getElementById('knowledge-item-form-title').value = title;
  document.getElementById('knowledge-item-form-keywords').value = keywords;
  document.getElementById('knowledge-item-form-content').value = content;
  document.getElementById('knowledge-item-form-title').textContent = itemId ? '编辑知识条目' : '添加知识条目';
}

function hideKnowledgeItemFormModal() {
  document.getElementById('knowledge-item-form-modal').classList.add('hidden');
}

async function saveKnowledgeItem(event) {
  event.preventDefault();
  
  const itemId = document.getElementById('knowledge-item-form-id').value;
  const baseId = document.getElementById('knowledge-item-form-base-id').value;
  const title = document.getElementById('knowledge-item-form-title').value;
  const keywords = document.getElementById('knowledge-item-form-keywords').value;
  const content = document.getElementById('knowledge-item-form-content').value;

  try {
    if (itemId) {
      const response = await fetch(`${API_BASE}/api/admin/knowledge-items/${itemId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title, keywords, content })
      });

      if (!response.ok) {
        throw new Error('更新知识条目失败');
      }
    } else {
      const response = await fetch(`${API_BASE}/api/admin/knowledge-bases/${baseId}/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title, keywords, content })
      });

      if (!response.ok) {
        throw new Error('添加知识条目失败');
      }
    }

    hideKnowledgeItemFormModal();
    showToast('知识条目已保存', 'success');
    await loadKnowledgeItems(baseId);
  } catch (error) {
    console.error('Error saving knowledge item:', error);
    showToast(error.message, 'error');
  }
}

function editKnowledgeItem(itemId, baseId, title, keywords, content) {
  showKnowledgeItemFormModal(itemId, baseId, title, keywords, content);
}

async function deleteKnowledgeItem(itemId) {
  if (!confirm('确定要删除这个知识条目吗？')) return;

  try {
    const response = await fetch(`${API_BASE}/api/admin/knowledge-items/${itemId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('删除知识条目失败');
    }

    await loadKnowledgeItems(currentKnowledgeBaseId);
  } catch (error) {
    console.error('Error deleting knowledge item:', error);
    alert('删除知识条目失败');
  }
}

// ==================== Utilities ====================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== Event Listeners ====================

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errorDiv = document.getElementById('login-error');

  try {
    errorDiv.textContent = '';
    await login(username, password);
    showChatPage();
    await loadConversations();
  } catch (error) {
    errorDiv.textContent = error.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  showConfirmDialog(
    '退出登录',
    '确定要退出当前账号吗？',
    'fas fa-sign-out-alt',
    () => {
      logout();
      showToast('已退出登录', 'success');
    }
  );
});
document.getElementById('new-chat-btn').addEventListener('click', createConversation);

document.getElementById('delete-conversation-btn').addEventListener('click', async () => {
  if (currentConversationId) {
    const conv = conversations.find(c => c.id === currentConversationId);
    const title = conv ? conv.title : '此对话';
    
    showConfirmDialog(
      '删除对话',
      `确定要删除「${title}」吗？此操作不可撤销。`,
      'fas fa-trash-alt',
      async () => {
        await deleteConversation(currentConversationId, { stopPropagation: () => {} });
        showToast('对话已删除', 'success');
      }
    );
  } else {
    showToast('请先选择一个对话', 'info');
  }
});

document.getElementById('message-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.getElementById('message-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 150) + 'px';
});

document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('admin-toggle-btn').addEventListener('click', showAdminModal);

// Confirm Dialog handlers
let confirmCallback = null;
document.getElementById('confirm-ok-btn').addEventListener('click', async () => {
  document.getElementById('confirm-dialog').classList.add('hidden');
  if (confirmCallback) {
    try {
      await confirmCallback();
    } catch (e) {
      showToast(e.message || '操作失败', 'error');
    }
  }
});
document.getElementById('confirm-cancel-btn').addEventListener('click', () => {
  document.getElementById('confirm-dialog').classList.add('hidden');
  confirmCallback = null;
});
document.getElementById('close-modal-btn').addEventListener('click', hideAdminModal);
document.getElementById('create-user-btn').addEventListener('click', () => showUserFormModal());
document.getElementById('close-user-form-btn').addEventListener('click', hideUserFormModal);
document.getElementById('user-form').addEventListener('submit', saveUser);

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  });
});

// LLM Settings
document.getElementById('llm-settings-form').addEventListener('submit', saveLLMSettings);

// Prompts
document.getElementById('create-prompt-btn').addEventListener('click', () => showPromptFormModal());
document.getElementById('close-prompt-form-btn').addEventListener('click', hidePromptFormModal);
document.getElementById('prompt-form').addEventListener('submit', savePrompt);

document.getElementById('test-prompt-btn').addEventListener('click', showPromptTestModal);
document.getElementById('close-prompt-test-btn').addEventListener('click', hidePromptTestModal);
document.getElementById('run-test-btn').addEventListener('click', runPromptTest);

// Knowledge Bases
document.getElementById('create-knowledge-base-btn').addEventListener('click', () => showKnowledgeBaseFormModal());
document.getElementById('close-knowledge-base-form-btn').addEventListener('click', hideKnowledgeBaseFormModal);
document.getElementById('knowledge-base-form').addEventListener('submit', saveKnowledgeBase);
document.getElementById('back-to-bases-btn').addEventListener('click', backToKnowledgeBases);

// Knowledge Items
document.getElementById('create-knowledge-item-btn').addEventListener('click', () => showKnowledgeItemFormModal());
document.getElementById('close-knowledge-item-form-btn').addEventListener('click', hideKnowledgeItemFormModal);
document.getElementById('knowledge-item-form').addEventListener('submit', saveKnowledgeItem);

// Document Upload
document.getElementById('upload-document-btn')?.addEventListener('click', () => {
  if (!currentKnowledgeBaseId) {
    showToast('请先选择知识库', 'error');
    return;
  }
  document.getElementById('document-file-input').click();
});

document.getElementById('document-file-input')?.addEventListener('change', async (e) => {
  const files = e.target.files;
  if (files.length === 0) return;
  
  await uploadDocuments(files, currentKnowledgeBaseId);
  
  // Reset file input
  e.target.value = '';
});

// ==================== Start ====================

// Toast notification
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideInRight 0.3s ease-out reverse';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Custom confirm dialog
function showConfirmDialog(title, message, iconClass, onConfirm) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-icon').className = iconClass;
  confirmCallback = onConfirm;
  document.getElementById('confirm-dialog').classList.remove('hidden');
}

init();

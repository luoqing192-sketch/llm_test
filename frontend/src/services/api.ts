import axios from 'axios';
import type {
  LoginResponse,
  User,
  Conversation,
  Message,
  LLMSettings,
  Prompt,
  KnowledgeBase,
  KnowledgeItem,
  DocItem,
  QueueStatus,
} from '@/types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// JWT interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 401 auto-redirect
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ==================== Auth ====================

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { username, password }),

  me: () => api.get<User>('/auth/me'),
};

// ==================== Conversations ====================

export const conversationsApi = {
  list: () => api.get<Conversation[]>('/conversations'),

  create: (title?: string) =>
    api.post<Conversation>('/conversations', { title }),

  messages: (id: number) =>
    api.get<Message[]>(`/conversations/${id}/messages`),

  delete: (id: number) =>
    api.delete(`/conversations/${id}`),
};

// ==================== Chat ====================

export const chatApi = {
  uploadFile: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/chat/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ==================== Queue ====================

export const queueApi = {
  status: () => api.get<QueueStatus>('/queue/status'),
};

// ==================== Admin: Users ====================

export const usersApi = {
  list: () => api.get<User[]>('/admin/users'),

  create: (username: string, password: string, role: string = 'user') =>
    api.post('/admin/users', { username, password, role }),

  resetPassword: (id: number, password: string) =>
    api.put(`/admin/users/${id}/password`, { password }),

  delete: (id: number) => api.delete(`/admin/users/${id}`),
};

// ==================== Admin: Settings ====================

export const settingsApi = {
  get: () => api.get<LLMSettings>('/admin/settings'),

  update: (settings: Partial<LLMSettings>) =>
    api.put('/admin/settings', settings),
};

// ==================== Admin: Prompts ====================

export const promptsApi = {
  list: () => api.get<Prompt[]>('/admin/prompts'),

  create: (data: Partial<Prompt>) =>
    api.post<Prompt>('/admin/prompts', data),

  update: (id: number, data: Partial<Prompt>) =>
    api.put<Prompt>(`/admin/prompts/${id}`, data),

  delete: (id: number) => api.delete(`/admin/prompts/${id}`),

  activate: (id: number) => api.post(`/admin/prompts/${id}/activate`),

  deactivate: (id: number) => api.post(`/admin/prompts/${id}/deactivate`),

  getActive: () => api.get<Prompt | null>('/admin/prompts/active'),
};

// ==================== Admin: Knowledge Bases ====================

export const knowledgeBasesApi = {
  list: () => api.get<KnowledgeBase[]>('/admin/knowledge-bases'),

  create: (name: string, description: string = '') =>
    api.post<KnowledgeBase>('/admin/knowledge-bases', { name, description }),

  update: (id: number, data: { name: string; description: string }) =>
    api.put<KnowledgeBase>(`/admin/knowledge-bases/${id}`, data),

  delete: (id: number) => api.delete(`/admin/knowledge-bases/${id}`),
};

// ==================== Admin: Knowledge Items ====================

export const knowledgeItemsApi = {
  list: (baseId: number) =>
    api.get<KnowledgeItem[]>(`/admin/knowledge-bases/${baseId}/items`),

  create: (baseId: number, data: { title: string; content: string; keywords?: string }) =>
    api.post<KnowledgeItem>(`/admin/knowledge-bases/${baseId}/items`, data),

  update: (id: number, data: { title: string; content: string; keywords?: string }) =>
    api.put<KnowledgeItem>(`/admin/knowledge-items/${id}`, data),

  delete: (id: number) => api.delete(`/admin/knowledge-items/${id}`),

  search: (query: string) =>
    api.get<KnowledgeItem[]>('/admin/knowledge/search', { params: { query } }),
};

// ==================== Admin: Documents ====================

export const documentsApi = {
  list: (baseId: number) =>
    api.get<DocItem[]>(`/admin/knowledge-bases/${baseId}/documents`),

  upload: (file: File, knowledgeBaseId: number) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('knowledge_base_id', String(knowledgeBaseId));
    return api.post('/admin/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  delete: (id: number) => api.delete(`/admin/documents/${id}`),
};

export default api;

import { create } from 'zustand';
import type { Message } from '@/types';

interface ChatState {
  currentConversationId: number | null;
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;
  ragNotice: string | null;
  queuePending: number;
  queueActive: number;
  toolProgress: { tool: string; status: string } | null;
  previewUrl: string | null;

  setCurrentConversation: (id: number | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setIsStreaming: (streaming: boolean) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  setRagNotice: (notice: string | null) => void;
  finalizeStreaming: () => void;
  setQueueStatus: (pending: number, active: number) => void;
  setToolProgress: (progress: { tool: string; status: string } | null) => void;
  setPreviewUrl: (url: string | null) => void;
  clearCodeGenState: () => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  currentConversationId: null,
  messages: [],
  isStreaming: false,
  streamingContent: '',
  ragNotice: null,
  queuePending: 0,
  queueActive: 0,
  toolProgress: null,
  previewUrl: null,

  setCurrentConversation: (id) =>
    set({ currentConversationId: id, messages: [], streamingContent: '', previewUrl: null, toolProgress: null }),

  setMessages: (messages) => set({ messages }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  setIsStreaming: (streaming) => {
    if (streaming) {
      set({ isStreaming: true, toolProgress: null });
    } else {
      set({ isStreaming: false });
    }
  },

  setStreamingContent: (content) => set({ streamingContent: content }),

  appendStreamingContent: (chunk) =>
    set((state) => ({ streamingContent: state.streamingContent + chunk })),

  setRagNotice: (notice) => set({ ragNotice: notice }),

  finalizeStreaming: () => {
    const { streamingContent, currentConversationId } = get();
    if (streamingContent && currentConversationId) {
      const assistantMessage: Message = {
        id: Date.now(),
        conversation_id: currentConversationId,
        role: 'assistant',
        content: streamingContent,
        created_at: new Date().toISOString(),
      };
      set((state) => ({
        messages: [...state.messages, assistantMessage],
        streamingContent: '',
        ragNotice: null,
        isStreaming: false,
      }));
    } else {
      set({ streamingContent: '', ragNotice: null, isStreaming: false });
    }
  },

  setQueueStatus: (pending, active) =>
    set({ queuePending: pending, queueActive: active }),

  setToolProgress: (progress) => set({ toolProgress: progress }),

  setPreviewUrl: (url) => set({ previewUrl: url }),

  clearCodeGenState: () => set({ toolProgress: null, previewUrl: null }),

  reset: () =>
    set({
      currentConversationId: null,
      messages: [],
      isStreaming: false,
      streamingContent: '',
      ragNotice: null,
      queuePending: 0,
      queueActive: 0,
      toolProgress: null,
      previewUrl: null,
    }),
}));

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  usersApi,
  settingsApi,
  promptsApi,
  knowledgeBasesApi,
  knowledgeItemsApi,
  wikiApi,
} from '@/services/api';
import type { LLMSettings, Prompt } from '@/types';

// ==================== Users ====================

export function useUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => usersApi.list().then((r) => r.data),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { username: string; password: string; role?: string }) =>
      usersApi.create(data.username, data.password, data.role || 'user'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => usersApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      usersApi.resetPassword(id, password),
  });
}

// ==================== Settings ====================

export function useSettings() {
  return useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => settingsApi.get().then((r) => r.data),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: Partial<LLMSettings>) => settingsApi.update(settings),
    onSuccess: (_, variables) => {
      // 立即同步更新缓存，不等 refetch
      queryClient.setQueryData(['admin', 'settings'], (old: LLMSettings | undefined) => {
        if (!old) return old;
        return { ...old, ...variables };
      });
      // 同时触发后台 refetch 确认一致
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
  });
}

// ==================== Prompts ====================

export function usePrompts() {
  return useQuery({
    queryKey: ['admin', 'prompts'],
    queryFn: () => promptsApi.list().then((r) => r.data),
  });
}

export function useCreatePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Prompt>) => promptsApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'prompts'] }),
  });
}

export function useUpdatePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Prompt> }) =>
      promptsApi.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'prompts'] }),
  });
}

export function useDeletePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => promptsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'prompts'] }),
  });
}

export function useActivatePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => promptsApi.activate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'prompts'] }),
  });
}

export function useDeactivatePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => promptsApi.deactivate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'prompts'] }),
  });
}

// ==================== Knowledge Bases ====================

export function useKnowledgeBases() {
  return useQuery({
    queryKey: ['admin', 'knowledgeBases'],
    queryFn: () => knowledgeBasesApi.list().then((r) => r.data),
  });
}

export function useCreateKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      knowledgeBasesApi.create(name, description),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['admin', 'knowledgeBases'] }),
  });
}

export function useDeleteKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => knowledgeBasesApi.delete(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['admin', 'knowledgeBases'] }),
  });
}

// ==================== Knowledge Items ====================

export function useKnowledgeItems(baseId: number | null) {
  return useQuery({
    queryKey: ['admin', 'knowledgeItems', baseId],
    queryFn: () =>
      baseId ? knowledgeItemsApi.list(baseId).then((r) => r.data) : [],
    enabled: baseId !== null,
  });
}

export function useCreateKnowledgeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      baseId,
      data,
    }: {
      baseId: number;
      data: { title: string; content: string; keywords?: string };
    }) => knowledgeItemsApi.create(baseId, data),
    onSuccess: (_, { baseId }) => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'knowledgeItems', baseId],
      });
    },
  });
}

export function useUpdateKnowledgeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
      baseId,
    }: {
      id: number;
      data: { title: string; content: string; keywords?: string };
      baseId: number;
    }) => knowledgeItemsApi.update(id, data).then(() => baseId),
    onSuccess: (baseId) => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'knowledgeItems', baseId],
      });
    },
  });
}

export function useDeleteKnowledgeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, baseId }: { id: number; baseId: number }) =>
      knowledgeItemsApi.delete(id).then(() => baseId),
    onSuccess: (baseId) => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'knowledgeItems', baseId],
      });
    },
  });
}

// ==================== Wiki Files ====================

export function useWikiFiles() {
  return useQuery({
    queryKey: ['admin', 'wiki'],
    queryFn: () => wikiApi.list().then((r) => r.data),
  });
}

export function useUploadWikiFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => wikiApi.upload(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wiki'] });
    },
  });
}

export function useDeleteWikiFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) => wikiApi.delete(filename),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wiki'] });
    },
  });
}

export function useOrganizeWiki() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (task?: string) => wikiApi.organize(task),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'wiki'] });
    },
  });
}

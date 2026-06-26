import { useState, useRef } from 'react';
import { Input, Button, Upload, message } from 'antd';
import { SendOutlined, PaperClipOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useChatStore } from '@/stores/chatStore';
import { streamChat } from '@/services/sse';
import { chatApi } from '@/services/api';

const { TextArea } = Input;

export default function MessageInput() {
  const [inputValue, setInputValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();
  const {
    currentConversationId,
    isStreaming,
    setIsStreaming,
    setStreamingContent,
    appendStreamingContent,
    finalizeStreaming,
    setQueueStatus,
    setRagNotice,
    setToolProgress,
    setPreviewUrl,
  } = useChatStore();
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || !currentConversationId || isStreaming) return;

    setInputValue('');

    // 乐观更新：直接写入 React Query cache，MessageList 立即显示
    const userMessage = {
      id: Date.now(),
      conversation_id: currentConversationId,
      role: 'user' as const,
      content: text,
      created_at: new Date().toISOString(),
    };
    queryClient.setQueryData(
      ['messages', currentConversationId],
      (old: any[] | undefined) => [...(old || []), userMessage]
    );

    setIsStreaming(true);
    setStreamingContent('');
    setRagNotice(null);

    await streamChat(currentConversationId, text, {
      onChunk: (content) => {
        appendStreamingContent(content);
      },
      onDone: () => {
        finalizeStreaming();
        queryClient.invalidateQueries({ queryKey: ['messages', currentConversationId] });
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
      },
      onError: (error) => {
        message.error(error);
        finalizeStreaming();
        queryClient.invalidateQueries({ queryKey: ['messages', currentConversationId] });
      },
      onQueueStatus: (pending, active) => {
        setQueueStatus(pending, active);
      },
      onNotice: (notice) => {
        setRagNotice(notice);
      },
      onToolProgress: (tool, status) => {
        setToolProgress({ tool, status });
      },
      onPreview: (url) => {
        setPreviewUrl(url);
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      await chatApi.uploadFile(file);
      message.success(`文件 "${file.name}" 上传成功`);
    } catch {
      message.error('文件上传失败');
    } finally {
      setUploading(false);
    }
    return false;
  };

  return (
    <div style={{
      padding: '14px 32px 20px',
      background: 'var(--bg-card)',
      boxShadow: '0 -1px 4px rgba(0, 0, 0, 0.04)',
    }}>
      <div style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-end',
        background: 'var(--bg-main)',
        borderRadius: 14,
        padding: '8px 8px 8px 14px',
        border: '1px solid var(--border)',
        transition: 'border-color 0.2s ease',
      }}>
        <Upload
          beforeUpload={handleFileUpload}
          showUploadList={false}
          accept=".txt,.pdf,.doc,.docx,.md,.csv"
        >
          <Button
            type="text"
            icon={<PaperClipOutlined />}
            loading={uploading}
            disabled={!currentConversationId || isStreaming}
            style={{ color: 'var(--text-muted)', border: 'none' }}
          />
        </Upload>

        <TextArea
          ref={textAreaRef as any}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={currentConversationId ? '输入消息... (Enter 发送)' : '请先选择一个对话'}
          disabled={!currentConversationId || isStreaming}
          autoSize={{ minRows: 1, maxRows: 6 }}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            boxShadow: 'none',
            resize: 'none',
            padding: '4px 0',
            fontSize: 14,
          }}
          variant="borderless"
        />

        <Button
          type="primary"
          shape="circle"
          icon={<SendOutlined style={{ fontSize: 14 }} />}
          onClick={handleSend}
          loading={isStreaming}
          disabled={!currentConversationId || !inputValue.trim() || isStreaming}
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
          }}
        />
      </div>
    </div>
  );
}

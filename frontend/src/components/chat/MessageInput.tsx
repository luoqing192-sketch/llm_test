import { useState, useRef } from 'react';
import { Input, Button, Upload, message } from 'antd';
import { SendOutlined, PaperClipOutlined } from '@ant-design/icons';
import { useChatStore } from '@/stores/chatStore';
import { streamChat } from '@/services/sse';
import { chatApi } from '@/services/api';

const { TextArea } = Input;

export default function MessageInput() {
  const [inputValue, setInputValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const {
    currentConversationId,
    isStreaming,
    addMessage,
    setIsStreaming,
    setStreamingContent,
    appendStreamingContent,
    finalizeStreaming,
    setQueueStatus,
  } = useChatStore();
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || !currentConversationId || isStreaming) return;

    setInputValue('');

    // Add user message locally for immediate display
    addMessage({
      id: Date.now(),
      conversation_id: currentConversationId,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    });

    // Start streaming
    setIsStreaming(true);
    setStreamingContent('');

    await streamChat(currentConversationId, text, {
      onChunk: (content) => {
        appendStreamingContent(content);
      },
      onDone: () => {
        finalizeStreaming();
      },
      onError: (error) => {
        message.error(error);
        finalizeStreaming();
      },
      onQueueStatus: (pending, active) => {
        setQueueStatus(pending, active);
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
    return false; // prevent antd default upload
  };

  return (
    <div style={{
      padding: '12px 24px',
      borderTop: '1px solid #f0f0f0',
      background: '#fff',
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <Upload
          beforeUpload={handleFileUpload}
          showUploadList={false}
          accept=".txt,.pdf,.doc,.docx,.md,.csv"
        >
          <Button
            icon={<PaperClipOutlined />}
            loading={uploading}
            disabled={!currentConversationId || isStreaming}
          />
        </Upload>

        <TextArea
          ref={textAreaRef as any}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={currentConversationId ? '输入消息... (Enter 发送, Shift+Enter 换行)' : '请先选择一个对话'}
          disabled={!currentConversationId || isStreaming}
          autoSize={{ minRows: 1, maxRows: 6 }}
          style={{ flex: 1 }}
        />

        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={isStreaming}
          disabled={!currentConversationId || !inputValue.trim() || isStreaming}
        >
          发送
        </Button>
      </div>
    </div>
  );
}

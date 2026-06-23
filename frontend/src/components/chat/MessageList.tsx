import { useEffect, useRef } from 'react';
import { Typography, Avatar, Spin } from 'antd';
import { RobotOutlined, UserOutlined, LoadingOutlined } from '@ant-design/icons';
import { useChatStore } from '@/stores/chatStore';
import { useConversationMessages } from '@/hooks/useConversations';
import dayjs from 'dayjs';

export default function MessageList() {
  const { currentConversationId, isStreaming, streamingContent } = useChatStore();
  const { data: messages, isLoading } = useConversationMessages(currentConversationId);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  if (!currentConversationId) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        color: '#999',
      }}>
        <div style={{ textAlign: 'center' }}>
          <RobotOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }} />
          <div>选择或创建一个对话开始聊天</div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '16px 24px',
      }}
    >
      {(messages || []).map((msg) => (
        <MessageBubble key={msg.id} role={msg.role} content={msg.content} time={msg.created_at} />
      ))}

      {/* Streaming response */}
      {isStreaming && (
        <MessageBubble
          role="assistant"
          content={streamingContent || ''}
          isStreaming={!streamingContent}
        />
      )}
    </div>
  );
}

function MessageBubble({
  role,
  content,
  time,
  isStreaming,
}: {
  role: string;
  content: string;
  time?: string;
  isStreaming?: boolean;
}) {
  const isUser = role === 'user';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 16,
    }}>
      {!isUser && (
        <Avatar
          icon={<RobotOutlined />}
          style={{
            backgroundColor: '#722ed1',
            marginRight: 12,
            flexShrink: 0,
          }}
        />
      )}

      <div style={{ maxWidth: '70%' }}>
        <div style={{
          padding: '10px 16px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: isUser ? '#1677ff' : '#f5f5f5',
          color: isUser ? '#fff' : '#333',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {isStreaming && !content ? (
            <LoadingOutlined style={{ color: '#999' }} />
          ) : (
            content
          )}
        </div>
        {time && (
          <Typography.Text
            style={{
              fontSize: 11,
              color: '#999',
              marginTop: 4,
              display: 'block',
              textAlign: isUser ? 'right' : 'left',
            }}
          >
            {dayjs(time).format('HH:mm')}
          </Typography.Text>
        )}
      </div>

      {isUser && (
        <Avatar
          icon={<UserOutlined />}
          style={{
            backgroundColor: '#1677ff',
            marginLeft: 12,
            flexShrink: 0,
          }}
        />
      )}
    </div>
  );
}

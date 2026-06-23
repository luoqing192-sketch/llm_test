import {
  PlusOutlined,
  DeleteOutlined,
  MessageOutlined,
  SettingOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { Button, List, Typography, Space, Popconfirm, Tooltip } from 'antd';
import { useConversations, useCreateConversation, useDeleteConversation } from '@/hooks/useConversations';
import { useChatStore } from '@/stores/chatStore';
import { useAuthStore } from '@/stores/authStore';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

export default function ConversationSidebar() {
  const { data: conversations, isLoading } = useConversations();
  const createMutation = useCreateConversation();
  const deleteMutation = useDeleteConversation();
  const { currentConversationId, setCurrentConversation } = useChatStore();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleNewConversation = () => {
    createMutation.mutate(undefined);
  };

  const handleSelect = (id: number) => {
    setCurrentConversation(id);
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate(id);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#1a1a2e',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}>
          <Typography.Title level={5} style={{ color: '#fff', margin: 0 }}>
            AI 聊天助手
          </Typography.Title>
          <Space size={4}>
            {user?.role === 'admin' && (
              <Tooltip title="管理后台">
                <Button
                  type="text"
                  icon={<SettingOutlined />}
                  size="small"
                  style={{ color: 'rgba(255,255,255,0.65)' }}
                  onClick={() => navigate('/admin')}
                />
              </Tooltip>
            )}
            <Tooltip title="退出登录">
              <Button
                type="text"
                icon={<LogoutOutlined />}
                size="small"
                style={{ color: 'rgba(255,255,255,0.65)' }}
                onClick={handleLogout}
              />
            </Tooltip>
          </Space>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          block
          onClick={handleNewConversation}
          loading={createMutation.isPending}
        >
          新对话
        </Button>
      </div>

      {/* Conversation List */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
        {isLoading ? (
          <Typography.Text style={{ color: 'rgba(255,255,255,0.45)', padding: 16 }}>
            加载中...
          </Typography.Text>
        ) : (
          <List
            dataSource={conversations || []}
            renderItem={(conv) => (
              <div
                key={conv.id}
                onClick={() => handleSelect(conv.id)}
                style={{
                  padding: '10px 12px',
                  marginBottom: 4,
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: currentConversationId === conv.id
                    ? 'rgba(255,255,255,0.12)'
                    : 'transparent',
                  transition: 'background 0.2s',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
                onMouseEnter={(e) => {
                  if (currentConversationId !== conv.id) {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (currentConversationId !== conv.id) {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    color: '#fff',
                    fontSize: 13,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    <MessageOutlined style={{ marginRight: 8, opacity: 0.5 }} />
                    {conv.title}
                  </div>
                  <div style={{
                    color: 'rgba(255,255,255,0.35)',
                    fontSize: 11,
                    marginTop: 2,
                    paddingLeft: 22,
                  }}>
                    {dayjs(conv.updated_at).format('MM/DD HH:mm')}
                  </div>
                </div>
                <Popconfirm
                  title="确定删除此对话？"
                  onConfirm={(e) => {
                    e?.stopPropagation();
                    handleDelete(conv.id);
                  }}
                  onCancel={(e) => e?.stopPropagation()}
                  okText="删除"
                  cancelText="取消"
                >
                  <Button
                    type="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    style={{ color: 'rgba(255,255,255,0.35)', flexShrink: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popconfirm>
              </div>
            )}
          />
        )}
      </div>

      {/* User Info */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        color: 'rgba(255,255,255,0.65)',
        fontSize: 13,
      }}>
        {user?.username} ({user?.role === 'admin' ? '管理员' : '用户'})
      </div>
    </div>
  );
}

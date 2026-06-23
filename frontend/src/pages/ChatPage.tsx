import { Layout } from 'antd';
import ConversationSidebar from '@/components/chat/ConversationSidebar';
import MessageList from '@/components/chat/MessageList';
import MessageInput from '@/components/chat/MessageInput';
import QueueIndicator from '@/components/chat/QueueIndicator';

const { Sider, Content } = Layout;

export default function ChatPage() {
  return (
    <Layout style={{ height: '100vh' }}>
      <Sider
        width={280}
        style={{
          background: '#1a1a2e',
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        <ConversationSidebar />
      </Sider>

      <Content style={{ display: 'flex', flexDirection: 'column', background: '#fff' }}>
        <QueueIndicator />
        <MessageList />
        <MessageInput />
      </Content>
    </Layout>
  );
}

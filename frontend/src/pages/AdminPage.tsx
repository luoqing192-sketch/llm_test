import { Tabs, Layout, Button, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import UserManagement from '@/components/admin/UserManagement';
import LLMSettings from '@/components/admin/LLMSettings';
import PromptManagement from '@/components/admin/PromptManagement';
import KnowledgeManagement from '@/components/admin/KnowledgeManagement';

const { Header, Content } = Layout;

export default function AdminPage() {
  const navigate = useNavigate();

  const tabItems = [
    {
      key: 'users',
      label: '用户管理',
      children: <UserManagement />,
    },
    {
      key: 'settings',
      label: 'LLM 配置',
      children: <LLMSettings />,
    },
    {
      key: 'prompts',
      label: 'System Prompt 管理',
      children: <PromptManagement />,
    },
    {
      key: 'knowledge',
      label: '知识库',
      children: <KnowledgeManagement />,
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{
        background: '#fff',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #f0f0f0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
            返回聊天
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>管理后台</Typography.Title>
        </div>
      </Header>

      <Content style={{ padding: 24, background: '#f5f5f5' }}>
        <div style={{ background: '#fff', borderRadius: 8, padding: 24 }}>
          <Tabs items={tabItems} />
        </div>
      </Content>
    </Layout>
  );
}

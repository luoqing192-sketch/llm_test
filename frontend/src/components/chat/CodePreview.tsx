import React from 'react';
import { Button } from 'antd';
import { ExpandOutlined } from '@ant-design/icons';

interface CodePreviewProps {
  url: string;
}

const CodePreview: React.FC<CodePreviewProps> = ({ url }) => (
  <div style={{ marginTop: 12, border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' }}>
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 12px', background: '#fafafa', borderBottom: '1px solid #e8e8e8'
    }}>
      <span style={{ fontWeight: 500, fontSize: 13 }}>页面预览</span>
      <Button
        size="small"
        icon={<ExpandOutlined />}
        onClick={() => window.open(url, '_blank')}
      >
        新窗口打开
      </Button>
    </div>
    <iframe
      src={url}
      sandbox="allow-scripts allow-same-origin"
      style={{ width: '100%', height: '400px', border: 'none' }}
      title="代码预览"
    />
  </div>
);

export default CodePreview;

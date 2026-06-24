import { useState, useEffect } from 'react';
import {
  Card, Button, Space, Modal, Form, Input, Popconfirm, Typography,
  message, Upload, Table, Select,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, InboxOutlined,
  FileMarkdownOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import {
  useKnowledgeBases, useCreateKnowledgeBase, useDeleteKnowledgeBase,
  useKnowledgeItems, useCreateKnowledgeItem, useUpdateKnowledgeItem, useDeleteKnowledgeItem,
  useWikiFiles, useUploadWikiFile, useDeleteWikiFile, useOrganizeWiki,
} from '@/hooks/useAdminData';
import type { KnowledgeBase, KnowledgeItem } from '@/types';
import type { WikiFile } from '@/services/api';
import dayjs from 'dayjs';

const { TextArea } = Input;
const { Dragger } = Upload;

export default function KnowledgeManagement() {
  const { data: bases, isLoading: basesLoading } = useKnowledgeBases();
  const createBase = useCreateKnowledgeBase();
  const deleteBase = useDeleteKnowledgeBase();

  const [selectedBaseId, setSelectedBaseId] = useState<number | null>(null);

  useEffect(() => {
    if (!selectedBaseId && bases && bases.length > 0) {
      setSelectedBaseId(bases[0].id);
    }
  }, [bases, selectedBaseId]);

  const { data: items, isLoading: itemsLoading } = useKnowledgeItems(selectedBaseId);
  const createItem = useCreateKnowledgeItem();
  const updateItem = useUpdateKnowledgeItem();
  const deleteItem = useDeleteKnowledgeItem();

  const { data: wikiFiles, isLoading: wikiLoading } = useWikiFiles();
  const uploadWiki = useUploadWikiFile();
  const deleteWiki = useDeleteWikiFile();
  const organizeWiki = useOrganizeWiki();

  const [baseModalVisible, setBaseModalVisible] = useState(false);
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [baseForm] = Form.useForm();
  const [itemForm] = Form.useForm();

  const handleCreateBase = async (values: { name: string; description: string }) => {
    try {
      await createBase.mutateAsync(values);
      message.success('知识库已创建');
      setBaseModalVisible(false);
      baseForm.resetFields();
    } catch {
      message.error('创建失败');
    }
  };

  const handleCreateOrUpdateItem = async (values: { title: string; content: string; keywords: string }) => {
    if (!selectedBaseId) return;
    try {
      if (editingItem) {
        await updateItem.mutateAsync({ id: editingItem.id, data: values, baseId: selectedBaseId });
        message.success('知识条目已更新');
      } else {
        await createItem.mutateAsync({ baseId: selectedBaseId, data: values });
        message.success('知识条目已创建');
      }
      setItemModalVisible(false);
      setEditingItem(null);
      itemForm.resetFields();
    } catch {
      message.error('保存失败');
    }
  };

  const handleUploadWiki = async (file: File) => {
    if (!file.name.endsWith('.md')) {
      message.warning('仅支持 .md (Markdown) 文件');
      return false;
    }
    try {
      await uploadWiki.mutateAsync(file);
      message.success(`Wiki 文件 "${file.name}" 上传成功`);
    } catch {
      message.error('上传失败');
    }
    return false;
  };

  const handleOrganizeWiki = async () => {
    message.loading({ content: 'Wiki 整理中（LLM 正在分析文档...）', key: 'organize', duration: 0 });
    try {
      await organizeWiki.mutateAsync(undefined);
      message.success({ content: 'Wiki 整理完成！已生成/更新文档', key: 'organize' });
    } catch {
      message.error({ content: 'Wiki 整理失败', key: 'organize' });
    }
  };

  const wikiColumns = [
    {
      title: '标题',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (
        <Space>
          <FileMarkdownOutlined style={{ color: 'var(--primary)' }} />
          {name}
        </Space>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      render: (s: number) => s < 1024 ? `${s} B` : `${(s / 1024).toFixed(1)} KB`,
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'time',
      width: 140,
      render: (t: string) => dayjs(t).format('MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, record: WikiFile) => (
        <Popconfirm
          title="确定删除此 Wiki 文件？"
          onConfirm={() => deleteWiki.mutate(record.filename)}
        >
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  const itemColumns = [
    { title: '标题', dataIndex: 'title', key: 'title' },
    {
      title: '内容',
      dataIndex: 'content',
      key: 'content',
      ellipsis: true,
      render: (t: string) => t.substring(0, 80) + (t.length > 80 ? '...' : ''),
    },
    { title: '关键词', dataIndex: 'keywords', key: 'keywords' },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: unknown, record: KnowledgeItem) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingItem(record);
              itemForm.setFieldsValue(record);
              setItemModalVisible(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除？"
            onConfirm={() => {
              if (selectedBaseId) {
                deleteItem.mutate({ id: record.id, baseId: selectedBaseId });
              }
            }}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* Wiki Files — LLM 检索的知识来源 */}
      <Card
        title={
          <Space>
            <FileMarkdownOutlined />
            <span>Wiki 知识文件</span>
          </Space>
        }
        size="small"
        style={{ marginBottom: 24 }}
        extra={
          <Space>
            <Button
              icon={<ThunderboltOutlined />}
              onClick={handleOrganizeWiki}
              loading={organizeWiki.isPending}
              style={{ color: 'var(--primary)' }}
            >
              Wiki 整理
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              上传 .md 文件，聊天时 LLM 会自动检索相关内容
            </Typography.Text>
          </Space>
        }
      >
        <Dragger
          beforeUpload={handleUploadWiki}
          showUploadList={false}
          accept=".md"
          style={{ marginBottom: 16 }}
        >
          <p><InboxOutlined style={{ fontSize: 32, color: 'var(--primary)' }} /></p>
          <p>点击或拖拽 .md 文件到此区域上传</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            文件名即标题，上传后立即生效（无需重启）
          </p>
        </Dragger>

        <Table
          dataSource={wikiFiles || []}
          columns={wikiColumns}
          rowKey="filename"
          loading={wikiLoading}
          size="small"
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* Knowledge Base / Items（MySQL 知识条目，可选） */}
      <Typography.Title level={5}>知识库管理</Typography.Title>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Select
          placeholder="选择知识库"
          style={{ width: 240 }}
          loading={basesLoading}
          value={selectedBaseId}
          onChange={setSelectedBaseId}
          options={(bases || []).map((b: KnowledgeBase) => ({
            label: `${b.name} (${b.item_count || 0} 条)`,
            value: b.id,
          }))}
        />
        <Button icon={<PlusOutlined />} onClick={() => setBaseModalVisible(true)}>
          新建知识库
        </Button>
        {selectedBaseId && (
          <Popconfirm
            title="确定删除此知识库？所有内容将被删除"
            onConfirm={() => {
              deleteBase.mutate(selectedBaseId);
              setSelectedBaseId(null);
            }}
          >
            <Button danger icon={<DeleteOutlined />}>删除知识库</Button>
          </Popconfirm>
        )}
      </div>

      {selectedBaseId && (
        <Card
          title="知识条目"
          size="small"
          extra={
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingItem(null);
                itemForm.resetFields();
                setItemModalVisible(true);
              }}
            >
              添加条目
            </Button>
          }
        >
          <Table
            dataSource={items || []}
            columns={itemColumns}
            rowKey="id"
            loading={itemsLoading}
            size="small"
            pagination={{ pageSize: 5 }}
          />
        </Card>
      )}

      <Modal
        title="新建知识库"
        open={baseModalVisible}
        onCancel={() => setBaseModalVisible(false)}
        footer={null}
      >
        <Form form={baseForm} onFinish={handleCreateBase} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createBase.isPending}>创建</Button>
        </Form>
      </Modal>

      <Modal
        title={editingItem ? '编辑知识条目' : '添加知识条目'}
        open={itemModalVisible}
        onCancel={() => { setItemModalVisible(false); setEditingItem(null); }}
        footer={null}
        width={600}
      >
        <Form form={itemForm} onFinish={handleCreateOrUpdateItem} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true }]}>
            <TextArea rows={6} />
          </Form.Item>
          <Form.Item name="keywords" label="关键词（逗号分隔）">
            <Input />
          </Form.Item>
          <Space>
            <Button
              type="primary"
              htmlType="submit"
              loading={createItem.isPending || updateItem.isPending}
            >
              {editingItem ? '保存' : '添加'}
            </Button>
            <Button onClick={() => { setItemModalVisible(false); setEditingItem(null); }}>
              取消
            </Button>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}

import { useState, useEffect } from 'react';
import {
  Card, Button, Space, Modal, Form, Input, Popconfirm, Typography,
  message, Upload, Table, Select,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, InboxOutlined,
  CheckCircleOutlined, SyncOutlined, ClockCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import {
  useKnowledgeBases, useCreateKnowledgeBase, useDeleteKnowledgeBase,
  useKnowledgeItems, useCreateKnowledgeItem, useUpdateKnowledgeItem, useDeleteKnowledgeItem,
  useDocuments, useUploadDocument, useDeleteDocument,
} from '@/hooks/useAdminData';
import type { KnowledgeBase, KnowledgeItem, DocItem } from '@/types';
import dayjs from 'dayjs';

const { TextArea } = Input;
const { Dragger } = Upload;

export default function KnowledgeManagement() {
  // Knowledge Bases
  const { data: bases, isLoading: basesLoading } = useKnowledgeBases();
  const createBase = useCreateKnowledgeBase();
  const deleteBase = useDeleteKnowledgeBase();

  // Selected base
  const [selectedBaseId, setSelectedBaseId] = useState<number | null>(null);

  // 默认选中第一条知识库
  useEffect(() => {
    if (!selectedBaseId && bases && bases.length > 0) {
      setSelectedBaseId(bases[0].id);
    }
  }, [bases, selectedBaseId]);

  // Knowledge Items
  const { data: items, isLoading: itemsLoading } = useKnowledgeItems(selectedBaseId);
  const createItem = useCreateKnowledgeItem();
  const updateItem = useUpdateKnowledgeItem();
  const deleteItem = useDeleteKnowledgeItem();

  // Documents
  const { data: documents, isLoading: docsLoading } = useDocuments(selectedBaseId);
  const uploadDoc = useUploadDocument();
  const deleteDoc = useDeleteDocument();

  // Modals
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

  const handleUploadDoc = async (file: File) => {
    if (!selectedBaseId) {
      message.warning('请先选择知识库');
      return false;
    }
    try {
      await uploadDoc.mutateAsync({ file, baseId: selectedBaseId });
      message.success('文件上传成功，正在处理');
    } catch {
      message.error('上传失败');
    }
    return false;
  };

  const statusIcon: Record<string, React.ReactNode> = {
    completed: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
    processing: <SyncOutlined spin style={{ color: '#1677ff' }} />,
    pending: <ClockCircleOutlined style={{ color: '#faad14' }} />,
    failed: <CloseCircleOutlined style={{ color: '#ff4d4f' }} />,
  };

  const docColumns = [
    { title: '文件名', dataIndex: 'original_name', key: 'name' },
    {
      title: '大小',
      dataIndex: 'file_size',
      key: 'size',
      render: (s: number) => `${(s / 1024).toFixed(1)} KB`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Space>
          {statusIcon[status]}
          <span>{status}</span>
        </Space>
      ),
    },
    {
      title: '上传时间',
      dataIndex: 'uploaded_at',
      key: 'time',
      render: (t: string) => dayjs(t).format('MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: DocItem) => (
        <Popconfirm
          title="确定删除此文档？"
          onConfirm={() => {
            if (selectedBaseId) deleteDoc.mutate({ id: record.id, baseId: selectedBaseId });
          }}
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
      <Typography.Title level={5}>知识库管理</Typography.Title>

      {/* Knowledge Base Selector */}
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
        <>
          {/* Knowledge Items */}
          <Card
            title="知识条目"
            size="small"
            style={{ marginBottom: 16 }}
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

          {/* Documents */}
          <Card title="文档上传" size="small">
            <Dragger
              beforeUpload={handleUploadDoc}
              showUploadList={false}
              accept=".txt,.pdf,.doc,.docx,.md,.csv"
            >
              <p><InboxOutlined style={{ fontSize: 32, color: '#1677ff' }} /></p>
              <p>点击或拖拽文件到此区域上传</p>
              <p style={{ color: '#999', fontSize: 12 }}>支持 txt, pdf, doc, docx, md, csv 格式，最大 10MB</p>
            </Dragger>

            <Table
              dataSource={documents || []}
              columns={docColumns}
              rowKey="id"
              loading={docsLoading}
              size="small"
              style={{ marginTop: 16 }}
              pagination={{ pageSize: 5 }}
            />
          </Card>
        </>
      )}

      {/* Create Knowledge Base Modal */}
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

      {/* Create/Edit Knowledge Item Modal */}
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

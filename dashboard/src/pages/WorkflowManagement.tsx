/*
 * 工作流管理页面
 * 提供工作流列表、详情、执行历史查看功能
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Table,
  Card,
  Button,
  Space,
  Input,
  Tag,
  message,
  Drawer,
  Descriptions,
  Tabs,
  Timeline,
  Spin,
  Popconfirm,
} from 'antd';
import {
  ReloadOutlined,
  PlayCircleOutlined,
  StopOutlined,
  DeleteOutlined,
  EyeOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { workflowApi } from '../services/api';
import { ErrorHandler } from '../utils/error-handler';
import PageHeader from '../components/PageHeader';

/** 工作流状态 */
type WorkflowStatus = 'draft' | 'active' | 'archived';

/** 工作流数据结构 */
interface Workflow {
  _id: string;
  name: string;
  description?: string;
  creatorId: string;
  status: WorkflowStatus;
  tags: string[];
  nodes: any[];
  edges: any[];
  createdAt: string;
  updatedAt: string;
}

/** 执行历史数据结构 */
interface WorkflowRun {
  runId: string;
  workflowId: string;
  status: string;
  input: Record<string, any>;
  output?: Record<string, any>;
  nodeStates: any[];
  stats: {
    totalNodes: number;
    completedNodes: number;
    failedNodes: number;
  };
  createdAt: string;
}

const statusColors: Record<WorkflowStatus, string> = {
  draft: 'default',
  active: 'success',
  archived: 'warning',
};

const runStatusColors: Record<string, string> = {
  pending: 'default',
  running: 'processing',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'warning',
};

export default function WorkflowManagementPage() {
  const [items, setItems] = useState<Workflow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | 'all'>('all');

  const [detailOpen, setDetailOpen] = useState(false);
  const [currentWorkflow, setCurrentWorkflow] = useState<Workflow | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  /** 获取工作流列表 */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await workflowApi.list({
        page,
        keyword: appliedKeyword || undefined,
        pageSize,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      setItems(res.data?.items || []);
      setTotal(res.data?.total || 0);
    } catch (err) {
      ErrorHandler.handleApiError(err, '加载工作流列表失败');
    } finally {
      setLoading(false);
    }
  }, [appliedKeyword, page, pageSize, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /** 打开工作流详情 */
  const openDetail = async (record: Workflow) => {
    setDetailOpen(true);
    setCurrentWorkflow(record);
    setRuns([]);
    setRunsLoading(true);
    try {
      const res: any = await workflowApi.listRuns({
        workflowId: record._id,
        page: 1,
        pageSize: 50,
      });
      setRuns(res.data?.items || []);
    } catch (err) {
      ErrorHandler.handleApiError(err, '加载执行历史失败');
    } finally {
      setRunsLoading(false);
    }
  };

  /** 更新工作流状态 */
  const updateStatus = async (id: string, status: WorkflowStatus) => {
    try {
      await workflowApi.updateStatus(id, status);
      message.success('状态更新成功');
      fetchData();
    } catch (err) {
      ErrorHandler.handleApiError(err, '状态更新失败');
    }
  };

  /** 删除工作流 */
  const deleteWorkflow = async (id: string) => {
    try {
      await workflowApi.delete(id);
      message.success('删除成功');
      fetchData();
    } catch (err) {
      ErrorHandler.handleApiError(err, '删除失败');
    }
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: '_id',
      key: '_id',
      width: 200,
      ellipsis: true,
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: WorkflowStatus) => (
        <Tag color={statusColors[status]}>{status.toUpperCase()}</Tag>
      ),
    },
    {
      title: '节点数',
      key: 'nodes',
      width: 80,
      render: (_: any, record: Workflow) => record.nodes?.length || 0,
    },
    {
      title: '创建者',
      dataIndex: 'creatorId',
      key: 'creatorId',
      width: 150,
      ellipsis: true,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (date: string) => (date ? new Date(date).toLocaleString() : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 250,
      render: (_: any, record: Workflow) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => openDetail(record)}
          >
            详情
          </Button>
          {record.status === 'draft' && (
            <Button
              type="link"
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={() => updateStatus(record._id, 'active')}
            >
              启用
            </Button>
          )}
          {record.status === 'active' && (
            <Button
              type="link"
              size="small"
              icon={<StopOutlined />}
              onClick={() => updateStatus(record._id, 'draft')}
            >
              禁用
            </Button>
          )}
          {record.status !== 'archived' && (
            <Button
              type="link"
              size="small"
              icon={<InboxOutlined />}
              onClick={() => updateStatus(record._id, 'archived')}
            >
              归档
            </Button>
          )}
          <Popconfirm
            title="确定删除此工作流吗？"
            onConfirm={() => deleteWorkflow(record._id)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="工作流管理" subtitle="管理工作流定义和执行历史" />

      <Card>
        <Space style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder="搜索工作流名称"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={(value) => {
              setPage(1);
              setAppliedKeyword(value.trim());
            }}
            enterButton="搜索"
            style={{ width: 280 }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => fetchData()}>
            刷新
          </Button>
        </Space>

        <Table
          columns={columns}
          dataSource={items}
          rowKey="_id"
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </Card>

      {/* 工作流详情抽屉 */}
      <Drawer
        title={currentWorkflow?.name || '工作流详情'}
        placement="right"
        width={720}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      >
        {currentWorkflow && (
          <Tabs
            items={[
              {
                key: 'info',
                label: '基本信息',
                children: (
                  <Descriptions column={2} bordered size="small">
                    <Descriptions.Item label="ID">{currentWorkflow._id}</Descriptions.Item>
                    <Descriptions.Item label="名称">{currentWorkflow.name}</Descriptions.Item>
                    <Descriptions.Item label="状态">
                      <Tag color={statusColors[currentWorkflow.status]}>
                        {currentWorkflow.status.toUpperCase()}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="创建者">{currentWorkflow.creatorId}</Descriptions.Item>
                    <Descriptions.Item label="节点数">
                      {currentWorkflow.nodes?.length || 0}
                    </Descriptions.Item>
                    <Descriptions.Item label="连线数">
                      {currentWorkflow.edges?.length || 0}
                    </Descriptions.Item>
                    <Descriptions.Item label="描述" span={2}>
                      {currentWorkflow.description || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="标签" span={2}>
                      {currentWorkflow.tags?.map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                      )) || '-'}
                    </Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: 'nodes',
                label: '节点列表',
                children: (
                  <Table
                    dataSource={currentWorkflow.nodes || []}
                    rowKey="id"
                    size="small"
                    pagination={false}
                    columns={[
                      { title: 'ID', dataIndex: 'id', key: 'id' },
                      { title: '类型', dataIndex: 'type', key: 'type' },
                      {
                        title: '标签',
                        key: 'label',
                        render: (_: any, record: any) => record.data?.label || '-',
                      },
                    ]}
                  />
                ),
              },
              {
                key: 'runs',
                label: '执行历史',
                children: (
                  <Spin spinning={runsLoading}>
                    {runs.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                        暂无执行记录
                      </div>
                    ) : (
                      <Timeline
                        items={runs.map((run) => ({
                          color: runStatusColors[run.status] || 'gray',
                          children: (
                            <div>
                              <div>
                                <Tag color={runStatusColors[run.status]}>{run.status}</Tag>
                                <span style={{ marginLeft: 8 }}>
                                  {new Date(run.createdAt).toLocaleString()}
                                </span>
                              </div>
                              <div style={{ marginTop: 4, color: '#666' }}>
                                完成: {run.stats?.completedNodes || 0} / {run.stats?.totalNodes || 0}
                              </div>
                            </div>
                          ),
                        }))}
                      />
                    )}
                  </Spin>
                ),
              },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}

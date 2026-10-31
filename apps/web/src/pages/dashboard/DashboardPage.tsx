import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Col, Empty, Progress, Row, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons';
import { get, errorText, money, type RecordRow } from '../../services/workspace';
import { useAuthStore } from '../../stores/useAuthStore';
interface Overview {
  role: string;
  customers: number;
  openOpportunities: number;
  pipeline: string;
  signedAmount: string;
  received: string;
  outstanding: string;
  overdue: string;
  projects: number;
  funnel: { name: string; code: string; count: number; amount: string }[];
  actions: RecordRow[];
  financeNotice: string;
}
export default function DashboardPage() {
  const [data, setData] = useState<Overview>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const user = useAuthStore((s) => s.user),
    navigate = useNavigate();
  const load = async () => {
    setLoading(true);
    try {
      setData(await get<Overview>('/workspace/overview'));
      setError('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const role = (
    { admin: '系统管理工作台', manager: '团队经营工作台', sales: '我的销售工作台', boss: '经营驾驶舱' } as Record<
      string,
      string
    >
  )[data?.role ?? 'sales'];
  const maxCount = Math.max(1, ...(data?.funnel.map((s) => s.count) ?? [1]));
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TB CRM · OVERVIEW</div>
          <h1>{role}</h1>
          <Typography.Text type="secondary">
            {user?.name}，欢迎回来。
            {data?.role === 'sales'
              ? '聚焦客户跟进与成交机会。'
              : data?.role === 'manager'
                ? '掌握团队管道与执行进展。'
                : '从客户、销售到交付，查看业务全貌。'}
          </Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          刷新数据
        </Button>
      </div>
      {error && <Alert message={error} type="error" showIcon />}
      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>
          {[
            { title: '可见客户', value: data?.customers, path: '/customers' },
            { title: '进行中商机', value: data?.openOpportunities, path: '/opportunities' },
            { title: '销售管道金额', value: money(data?.pipeline), prefix: '¥', path: '/opportunities/board' },
            { title: '已签合同额', value: money(data?.signedAmount), prefix: '¥', path: '/contracts' },
            { title: '交付项目', value: data?.projects, path: '/projects' },
            { title: '未收金额 · 演示', value: money(data?.outstanding), prefix: '¥', path: '/finance/payment-plans' },
          ].map((k) => (
            <Col xs={24} sm={12} xl={8} key={k.title}>
              <Card className="metric-card" onClick={() => navigate(k.path)} hoverable>
                <Statistic title={k.title} value={k.value ?? '—'} prefix={k.prefix} />
                <div style={{ marginTop: 16, color: '#64748b' }}>
                  查看明细 <ArrowRightOutlined />
                </div>
              </Card>
            </Col>
          ))}
        </Row>
        <Row gutter={[20, 20]} style={{ marginTop: 24 }}>
          <Col xs={24} lg={14}>
            <Card
              title="销售漏斗"
              extra={
                <Button type="link" onClick={() => navigate('/opportunities/board')}>
                  查看商机
                </Button>
              }
            >
              {data?.funnel?.map((f, i) => (
                <div key={f.code} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>
                      {f.name} <Tag>{f.count} 个</Tag>
                    </span>
                    <strong>¥{money(f.amount)}</strong>
                  </div>
                  <Progress
                    percent={Math.round((f.count / maxCount) * 100)}
                    showInfo={false}
                    strokeColor={['#1e40af', '#2563eb', '#3b82f6', '#60a5fa'][i % 4]}
                  />
                </div>
              ))}
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card
              title="我的下一步"
              extra={
                <Button type="link" onClick={() => navigate('/actions')}>
                  全部行动
                </Button>
              }
            >
              {data?.actions?.length ? (
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={data.actions.slice(0, 6)}
                  columns={[
                    { title: '行动', dataIndex: 'title' },
                    {
                      title: '日期',
                      dataIndex: 'dueDate',
                      render: (v: unknown) => (v ? String(v).slice(0, 10) : '待安排'),
                    },
                  ]}
                />
              ) : (
                <Empty description="暂无行动计划" />
              )}
              <Space wrap style={{ marginTop: 20 }}>
                <Button onClick={() => navigate('/customers')}>客户经营</Button>
                <Button onClick={() => navigate('/approvals')}>审批中心</Button>
                <Button onClick={() => navigate('/ai')}>AI工作台</Button>
              </Space>
            </Card>
            <Card title="演示财务概览" style={{ marginTop: 20 }}>
              <Statistic title="逾期未收" prefix="¥" value={money(data?.overdue)} />
              <Alert
                type="info"
                message="演示系统，暂无财务处理功能"
                description={data?.financeNotice}
                style={{ marginTop: 16 }}
              />
            </Card>
          </Col>
        </Row>
      </Spin>
    </div>
  );
}

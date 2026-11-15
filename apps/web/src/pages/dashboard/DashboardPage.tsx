import Table from '../../components/BusinessTable';
import BusinessSort,{type BusinessSortValue} from '../../components/BusinessSort';
import StatisticsPeople, { statisticsPeopleFromParams, statisticsQuery } from '../../components/StatisticsPeople';
import { menuAccess } from '../../services/access';
import { useEffect, useRef, useState } from 'react';
import StatisticsPeriod, { defaultStatisticsRange } from '../../components/StatisticsPeriod';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Col, Empty, Progress, Row, Space, Spin, Statistic, Tag, Typography } from 'antd';
import { ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons';
import { get, errorText, money, type RecordRow } from '../../services/workspace';
import { useAuthStore } from '../../stores/useAuthStore';
interface Overview {
  restrictedModules?: string[];
  role: string;
  customers: number;
  openOpportunities: number;
  pipeline: string;
  signedAmount: string;
  received: string;
  invoiced: string;
  outstanding: string;
  overdue: string;
  projects: number;
  funnel: { name: string; code: string; count: number; amount: string }[];
  actions: RecordRow[];
  financeNotice: string;
  users: RecordRow[];
}
export default function DashboardPage() {
  const [people, setPeople] = useState(() => statisticsPeopleFromParams(new URLSearchParams(window.location.search)));
  const [period, setPeriod] = useState(() => { const p = new URLSearchParams(window.location.search); return { from: p.get('from') ?? defaultStatisticsRange().from, to: p.get('to') ?? defaultStatisticsRange().to }; });
  const [funnelSort,setFunnelSort]=useState<BusinessSortValue>({sortBy:'name',sortOrder:'asc'});
  const revision = useRef(0);
  const [data, setData] = useState<Overview>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const user = useAuthStore((s) => s.user),
    navigate = useNavigate();
  const load = async () => {
    const requestRevision = ++revision.current;
    setLoading(true);
    setData(undefined);
    try {
      const result = await get<Overview>('/workspace/overview', { ...period, ...people });
      if (requestRevision !== revision.current) return;
      setData(result);
      setError('');
    } catch (e) {
      if (requestRevision === revision.current) setError(errorText(e));
    } finally {
      if (requestRevision === revision.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () => { revision.current++; };
  }, [period.from, period.to, people.personRange, people.ownerId, people.deptId]);
  const role = (
    { admin: '系统管理工作台', manager: '团队经营工作台', sales: '我的销售工作台', boss: '经营驾驶舱' } as Record<
      string,
      string
    >
  )[data?.role ?? (user?.roles.includes('super_admin')?'admin':user?.roles.includes('gm')?'boss':user?.roles.includes('sales_manager')?'manager':'sales')];
  const can = (path: string) => menuAccess(path, user?.permissions ?? [], user?.roles.includes('super_admin') ?? false);
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
      <StatisticsPeriod value={period} onChange={setPeriod} />
      <StatisticsPeople value={people} onChange={setPeople} />
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message="客户/项目按建档日，管道按预计成交日，合同按签约日，回款/开票按实际日期，未收和逾期限定所选到期计划。不是历史期末余额快照。" />
      {error && <Alert message={error} type="error" showIcon />}
      {!!data?.restrictedModules?.length && (
        <Alert
          type="info"
          showIcon
          message="部分业务模块未授权，相应指标不参与统计；空值不代表公司没有这些业务。"
          style={{ marginBottom: 16 }}
        />
      )}
      <Spin spinning={loading}>
        <div style={{visibility:data?'visible':'hidden',minHeight:300}}>
        <Row gutter={[16, 16]}>
          {[
            { title: '期间建档客户', value: data?.customers, path: '/customers' },
            { title: '期间预计成交商机', value: data?.openOpportunities, path: '/opportunities' },
            { title: '期间销售管道金额', value: money(data?.pipeline), prefix: '¥', path: '/opportunities/board' },
            { title: '期间签约合同额', value: money(data?.signedAmount), prefix: '¥', path: '/contracts' },
            { title: '期间立项项目', value: data?.projects, path: '/projects' },
            { title: '期间到期计划 · 当前未收', value: money(data?.outstanding), prefix: '¥', path: '/finance/payment-plans' },
            { title: '期间实际回款', value: money(data?.received), prefix: '¥', path: '/receipts' },
            { title: '期间实际开票', value: money(data?.invoiced), prefix: '¥', path: '/invoices' },
          ]
            .filter((k) => can(k.path))
            .map((k) => (
              <Col xs={24} sm={12} xl={8} key={k.title}>
                <Card className="metric-card" onClick={() => navigate(`${k.path}?${statisticsQuery(period, people)}`)} hoverable>
                  <Statistic title={k.title} value={k.value ?? '—'} prefix={k.prefix} />
                  <div style={{ marginTop: 16, color: '#64748b' }}>
                    查看明细 <ArrowRightOutlined />
                  </div>
                </Card>
              </Col>
            ))}
        </Row>
        <Row gutter={[20, 20]} style={{ marginTop: 24 }}>
          {can('/opportunities') && (
            <Col xs={24} lg={14}>
              <Card
                title="开放商机漏斗"
                extra={
                  <Button type="link" onClick={() => navigate(`/opportunities/board?${statisticsQuery(period, people)}`)}>
                    查看商机
                  </Button>
                }
              >
                <BusinessSort value={funnelSort} fields={[{key:'name',label:'阶段名称'},{key:'count',label:'商机数量'},{key:'amount',label:'商机金额'}]} onChange={setFunnelSort}/>
                {[...(data?.funnel??[])].sort((a,b)=>(funnelSort.sortBy==='name'?a.name.localeCompare(b.name,'zh-CN'):Number(a[funnelSort.sortBy as 'count'|'amount'])-Number(b[funnelSort.sortBy as 'count'|'amount']))*(funnelSort.sortOrder==='asc'?1:-1)).map((f, i) => (
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
          )}
          {(can('/actions') || can('/finance/payment-plans')) && (
            <Col xs={24} lg={10}>
              {can('/actions') && (
                <Card
                  title={people.personRange === 'self' ? '我的下一步' : '所选范围待办'}
                  extra={
                    <Button type="link" onClick={() => navigate(`/actions?${statisticsQuery(period, people)}`)}>
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
                        ...(data?.role !== 'sales'
                          ? [
                              {
                                title: '负责人',
                                dataIndex: 'assigneeId',
                                render: (v: number) => String(data?.users.find((u) => u.id === v)?.name ?? '待确认'),
                              },
                            ]
                          : []),
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
              )}
              {can('/finance/payment-plans') && (
                <Card title="区间到期计划余额" style={{ marginTop: 20 }}>
                  <Statistic title="所选计划当前逾期未收" prefix="¥" value={money(data?.overdue)} />
                  <Alert
                    type="info"
                    message="收款与核销使用本地业务台账"
                    description={data?.financeNotice}
                    style={{ marginTop: 16 }}
                  />
                </Card>
              )}
            </Col>
          )}
        </Row>
        </div>
      </Spin>
    </div>
  );
}

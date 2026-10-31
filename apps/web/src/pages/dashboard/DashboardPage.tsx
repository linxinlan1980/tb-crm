import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Empty, List, Row, Statistic, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/useAuthStore';
import request from '../../services/request';

interface CustomerSummary { id: number; code: string; name: string; industry: string | null; poolType: string }
interface CustomerResult { items: CustomerSummary[]; meta: { total: number } }
interface Invocation { result: CustomerResult }

/** Workbench reads the same customer capability used by agents. No simulated totals. */
export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<CustomerResult | null>(null);
  const [hasError, setHasError] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = async (): Promise<void> => {
    setLoading(true);
    setHasError(false);
    try {
      const invocation = await request.post<unknown, Invocation>('/capabilities/customer.search/invoke', { pageSize: 5 });
      setCustomers(invocation.result);
    } catch {
      setHasError(true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  return (
    <div>
      <Typography.Title level={4}>你好，{user?.name || '用户'}</Typography.Title>
      <Typography.Paragraph type="secondary">查看客户近况，安排下一步跟进。</Typography.Paragraph>
      {hasError && <Alert type="error" showIcon message="客户信息暂时无法加载" action={<Button onClick={() => void load()}>重试</Button>} />}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}><Card loading={loading}><Statistic title="可查看客户" value={customers?.meta.total ?? '—'} /></Card></Col>
        <Col xs={24} md={8}><Card title="客户档案"><Button type="primary" onClick={() => navigate('/customers')}>查看客户</Button></Card></Col>
        <Col xs={24} md={8}><Card title="客户资源"><Button onClick={() => navigate('/pool/public')}>查看公海</Button></Card></Col>
      </Row>
      <Card title="客户概览" style={{ marginTop: 16 }} loading={loading}>
        {!customers?.items.length ? <Empty description="暂无可查看客户" /> :
          <List dataSource={customers.items} renderItem={(customer) => <List.Item key={customer.id}
            actions={[<Button key="view" type="link" onClick={() => navigate(`/customers/${customer.id}`)}>查看</Button>]}>
            <List.Item.Meta title={customer.name} description={`${customer.code} · ${customer.industry || '行业待补充'}`} />
          </List.Item>} />}
      </Card>
    </div>
  );
}

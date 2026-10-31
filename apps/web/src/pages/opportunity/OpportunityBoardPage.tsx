import { useState, useEffect } from 'react';
import { Card, Tag, Space, Typography, Row, Col, Badge, Empty, Spin } from 'antd';
import { useNavigate } from 'react-router-dom';
import request from '../../services/request';

const { Text } = Typography;

const STAGE_COLORS: Record<string, string> = {
  intention: '#94a3b8', contact: '#64748b', requirement: '#3b82f6',
  proposal: '#2563eb', negotiation: '#d97706', signing: '#16a34a',
  delivery: '#0d9488', acceptance: '#059669', closed: '#334155',
};

export default function OpportunityBoardPage() {
  const [loading, setLoading] = useState(true);
  const [funnel, setFunnel] = useState<any[]>([]);
  const [opps, setOpps] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      request.get('/opportunities/funnel') as any,
      request.get('/opportunities', { params: { pageSize: 200, status: 'open' } }) as any,
    ]).then(([funnelData, oppsData]) => {
      setFunnel(funnelData || []);
      setOpps(oppsData?.items || []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>商机看板</h2>
        <Space>
          {funnel.map((s) => (
            <Badge key={s.stage} count={s.count} style={{ backgroundColor: STAGE_COLORS[s.stage] || '#64748b' }} overflowCount={999}>
              <Tag style={{ marginRight: 12 }}>{s.name}</Tag>
            </Badge>
          ))}
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Text type="secondary">管道总额</Text><div style={{ fontSize: 24, fontWeight: 600 }}>¥{(funnel.reduce((s, f) => s + f.amount, 0) / 10000).toFixed(0)}万</div></Card></Col>
        <Col span={6}><Card size="small"><Text type="secondary">加权金额</Text><div style={{ fontSize: 24, fontWeight: 600 }}>¥{(funnel.reduce((s, f) => s + f.weightedAmount, 0) / 10000).toFixed(0)}万</div></Card></Col>
        <Col span={6}><Card size="small"><Text type="secondary">活跃商机</Text><div style={{ fontSize: 24, fontWeight: 600 }}>{opps.length}</div></Card></Col>
        <Col span={6}><Card size="small"><Text type="secondary">本月预计成交</Text><div style={{ fontSize: 24, fontWeight: 600 }}>¥{(opps.filter((o) => o.expectedCloseDate && new Date(o.expectedCloseDate).getMonth() === new Date().getMonth()).reduce((s, o) => s + Number(o.amount), 0) / 10000).toFixed(0)}万</div></Card></Col>
      </Row>

      {/* 看板列 */}
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
        {funnel.map((stage) => {
          const stageOpps = opps.filter((o) => o.stage === stage.stage);
          return (
            <div key={stage.stage} style={{ minWidth: 260, flex: '0 0 260px', background: '#f8fafc', borderRadius: 4, border: '1px solid #e2e8f0' }}>
              <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: STAGE_COLORS[stage.stage] }} />
                  <Text strong style={{ fontSize: 13 }}>{stage.name}</Text>
                  <Tag>{stageOpps.length}</Tag>
                </Space>
                <Text type="secondary" style={{ fontSize: 11 }}>¥{(stage.amount / 10000).toFixed(0)}万</Text>
              </div>
              <div style={{ padding: 8, maxHeight: 500, overflowY: 'auto' }}>
                {stageOpps.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无商机" style={{ margin: '20px 0' }} />}
                {stageOpps.map((opp) => (
                  <Card key={opp.id} size="small" hoverable style={{ marginBottom: 8, cursor: 'pointer' }} onClick={() => navigate(`/opportunities/${opp.id}`)}>
                    <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{opp.name}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>{opp.customer?.name}</Text>
                    <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 12, fontWeight: 500 }}>¥{Number(opp.amount).toLocaleString()}</Text>
                      <Space size={4}>
                        {opp.healthLevel && <Badge color={opp.healthLevel === 'green' ? '#16a34a' : opp.healthLevel === 'yellow' ? '#d97706' : '#dc2626'} />}
                        {opp.stageStallDays > stage.stallThresholdDays && <Tag color="red" style={{ fontSize: 10 }}>{opp.stageStallDays}天</Tag>}
                      </Space>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

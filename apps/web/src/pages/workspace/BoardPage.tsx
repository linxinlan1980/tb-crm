import { useAuthStore } from '../../stores/useAuthStore';
import { useState, useEffect } from 'react';
import { Alert, Button, Card, Space, Tag, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get, post, key, errorText, money, type RecordRow } from '../../services/workspace';
const stages = [
  ['intention', '意向'],
  ['contact', '初步接触'],
  ['requirement', '需求确认'],
  ['proposal', '方案报价'],
  ['negotiation', '商务谈判'],
  ['signing', '签约'],
  ['delivery', '交付'],
];
export default function BoardPage() {
  const canEdit = !useAuthStore((s) => s.user?.roles.includes('gm'));
  const [rows, setRows] = useState<RecordRow[]>([]),
    [total, setTotal] = useState(0),
    [error, setError] = useState('');
  const navigate = useNavigate();
  const load = async () => {
    try {
      const r = await get<{ items: RecordRow[]; meta: { total: number } }>('/workspace/opportunities', {
        pageSize: 100,
      });
      setRows(r.items);
      setTotal(r.meta.total);
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const advance = async (r: RecordRow) => {
    try {
      await post(`/workspace/opportunities/${r.id}/advance`, { requestKey: key(), expectedUpdatedAt: r.updatedAt });
      message.success('阶段已推进');
      await load();
    } catch (e) {
      message.error(errorText(e));
    }
  };
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SALES PIPELINE</div>
          <h1>商机看板</h1>
          <Typography.Text type="secondary">按阶段掌握管道，推进结果同步到商机列表。</Typography.Text>
        </div>
        <Button onClick={() => navigate('/opportunities')}>商机列表与报价</Button>
      </div>
      {error && <Alert type="error" message={error} />}{' '}
      {total > 100 && <Alert message="看板展示前100条，请使用列表筛选查看完整数据" type="info" />}
      <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 20 }}>
        {stages.map(([code, name], i) => {
          const list = rows.filter((r) => r.stage === code);
          return (
            <div key={code} style={{ minWidth: 260, width: 280, flexShrink: 0 }}>
              <div
                style={{
                  padding: 16,
                  background: '#e8eef8',
                  borderTop: `3px solid ${['#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#172554'][i]}`,
                  marginBottom: 12,
                }}
              >
                <Space>
                  <strong>{name}</strong>
                  <Tag>{list.length}</Tag>
                </Space>
                <div style={{ color: '#64748b', marginTop: 8 }}>
                  ¥{money(list.reduce((n, r) => n + Number(r.amount), 0))}
                </div>
              </div>
              {list.map((r) => (
                <Card key={r.id} size="small" style={{ marginBottom: 12 }}>
                  <strong>{String(r.name)}</strong>
                  <Typography.Paragraph style={{ marginTop: 12 }}>¥{money(r.amount)}</Typography.Paragraph>
                  <Tag>{String(r.status) === 'won' ? '已赢单' : '进行中'}</Tag>
                  {canEdit && r.status === 'open' && (
                    <Button type="link" onClick={() => void advance(r)}>
                      推进下一阶段 →
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

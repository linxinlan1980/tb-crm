import { useAuthStore } from '../../stores/useAuthStore';
import { useState, useEffect, useRef } from 'react';
import StatisticsPeriod, { defaultStatisticsRange } from '../../components/StatisticsPeriod';
import { Alert, Button, Card, Space, Tag, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { get, post, key, errorText, money, type RecordRow } from '../../services/workspace';
export default function BoardPage() {
  const [period,setPeriod]=useState(defaultStatisticsRange);
  const revision=useRef(0);
  const canEdit = !useAuthStore((s) => s.user?.roles.includes('gm'));
  const [stages, setStages] = useState<string[][]>([]);
  const [rows, setRows] = useState<RecordRow[]>([]),
    [total, setTotal] = useState(0),
    [error, setError] = useState('');
  const navigate = useNavigate();
  const load = async () => {
    const requestRevision=++revision.current;setRows([]);setTotal(0);
    try {
      const [r, definitions] = await Promise.all([
        get<{ items: RecordRow[]; meta: { total: number } }>('/workspace/opportunities', { pageSize: 100, ...period }),
        get<{ code: string; name: string }[]>('/commercial/opportunity-stages'),
      ]);
      if(r.meta.total>1000)throw new Error('所选区间超过1000条商机，请缩小日期范围后查看完整看板');
      const items=r.items.slice();
      for(let page=2;items.length<r.meta.total;page++){
        const next=await get<{items:RecordRow[];meta:{total:number}}>('/workspace/opportunities',{page,pageSize:100,...period});
        if(next.meta.total!==r.meta.total||!next.items.length)throw new Error('加载期间数据已变化，请刷新看板');
        items.push(...next.items);
      }
      if(new Set(items.map(i=>i.id)).size!==r.meta.total)throw new Error('加载期间数据已变化，请刷新看板');
      if(requestRevision!==revision.current)return;
      const known = definitions.map((d) => [d.code, d.name]);
      for (const row of items)
        if (!known.some(([code]) => code === String(row.stage)))
          known.push([String(row.stage), '历史阶段：' + String(row.stage)]);
      setStages(known);
      setRows(items);
      setTotal(r.meta.total);
      setError('');
    } catch (e) {
      if(requestRevision===revision.current)setError(errorText(e));
    }
  };
  useEffect(() => {
    void load();
    return ()=>{revision.current++;};
  }, [period.from,period.to]);
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
        <Button onClick={() => navigate(`/opportunities?from=${period.from}&to=${period.to}`)}>商机列表与报价</Button>
      </div>
      <StatisticsPeriod value={period} onChange={setPeriod} />
      <Typography.Paragraph type="secondary">按预计成交日期筛选，共{total}条；未填写预计成交日的商机请先在列表补齐。</Typography.Paragraph>
      {error && <Alert type="error" message={error} />}{' '}
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

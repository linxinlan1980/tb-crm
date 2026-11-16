import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Badge } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import request from '../../services/request';
import dayjs from 'dayjs';

const STAGE_MAP: Record<string, { text: string; color: string }> = {
  intention: { text: '意向', color: 'default' },
  contact: { text: '初步接触', color: 'default' },
  requirement: { text: '需求确认', color: 'processing' },
  proposal: { text: '方案报价', color: 'blue' },
  negotiation: { text: '商务谈判', color: 'orange' },
  signing: { text: '签约', color: 'green' },
  delivery: { text: '交付', color: 'cyan' },
  acceptance: { text: '验收', color: 'lime' },
  closed: { text: '结项', color: 'default' },
};

export default function OpportunityListPage() {
  const actionRef = useRef<ActionType>();
  const navigate = useNavigate();

  const columns: ProColumns[] = [
    { title: '商机名称', dataIndex: 'name', ellipsis: true, width: 200, render: (_, r) => <a onClick={() => navigate(`/opportunities/${r.id}`)}>{r.name}</a> },
    { title: '客户', dataIndex: ['customer', 'name'], width: 150, ellipsis: true, search: false },
    { title: '阶段', dataIndex: 'stage', width: 90, valueType: 'select', fieldProps: { options: Object.entries(STAGE_MAP).map(([k, v]) => ({ label: v.text, value: k })) }, render: (_, r) => { const s = STAGE_MAP[r.stage]; return s ? <Tag color={s.color}>{s.text}</Tag> : r.stage; } },
    { title: '金额', dataIndex: 'amount', width: 110, search: false, sorter: true, render: (_, r) => `¥${Number(r.amount).toLocaleString()}` },
    { title: '加权', dataIndex: 'weightedAmount', width: 100, search: false, render: (_, r) => <span style={{ color: '#64748b' }}>¥{Number(r.weightedAmount).toLocaleString()}</span> },
    { title: '预计成交', dataIndex: 'expectedCloseDate', width: 110, search: false, valueType: 'date', render: (_, r) => {
      if (!r.expectedCloseDate) return '—';
      const overdue = dayjs(r.expectedCloseDate).isBefore(dayjs());
      return <span style={{ color: overdue ? '#dc2626' : undefined }}>{dayjs(r.expectedCloseDate).format('YYYY-MM-DD')}{overdue ? ' ⚠' : ''}</span>;
    }},
    { title: '健康度', dataIndex: 'healthLevel', width: 80, search: false, render: (_, r) => r.healthLevel ? <Badge color={r.healthLevel === 'green' ? '#16a34a' : r.healthLevel === 'yellow' ? '#d97706' : '#dc2626'} text={r.healthScore ?? ''} /> : '—' },
    { title: '停留', dataIndex: 'stageStallDays', width: 70, search: false, render: (_, r) => r.stageStallDays > 30 ? <Tag color="red">{r.stageStallDays}天</Tag> : r.stageStallDays > 0 ? `${r.stageStallDays}天` : '—' },
    { title: '负责人', dataIndex: 'ownerId', width: 80, search: false },
    { title: '状态', dataIndex: 'status', width: 70, valueType: 'select', fieldProps: { options: [{ label: '进行中', value: 'open' }, { label: '赢单', value: 'won' }, { label: '输单', value: 'lost' }] }, render: (_, r) => <Tag color={r.status === 'open' ? 'blue' : r.status === 'won' ? 'green' : 'red'}>{r.status === 'open' ? '进行中' : r.status === 'won' ? '赢单' : r.status === 'lost' ? '输单' : r.status}</Tag> },
  ];

  return (
    <ProTable
      headerTitle="商机管理"
      actionRef={actionRef}
      rowKey="id"
      columns={columns}
      scroll={{ x: 1300 }}
      search={{ labelWidth: 'auto', defaultCollapsed: true }}
      request={async (params) => {
        const res: any = await request.get('/opportunities', { params: { page: params.current, pageSize: params.pageSize, stage: params.stage, status: params.status || 'open', keyword: params.name } });
        return { data: res.items, total: res.meta.total, success: true };
      }}
      toolBarRender={() => [
        <Button key="board" onClick={() => navigate('/opportunities/board')}>看板视图</Button>,
        <Button key="create" type="primary" icon={<PlusOutlined />}>新建商机</Button>,
      ]}
      pagination={{ defaultPageSize: 20 }}
    />
  );
}

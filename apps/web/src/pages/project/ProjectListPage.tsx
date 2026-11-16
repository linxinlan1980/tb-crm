import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Progress } from 'antd';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import request from '../../services/request';
import dayjs from 'dayjs';

const STAGE_MAP: Record<string, { text: string; color: string }> = {
  initiation: { text: '立项', color: 'default' },
  blueprint: { text: '蓝图', color: 'processing' },
  development: { text: '开发', color: 'blue' },
  testing: { text: '测试', color: 'cyan' },
  go_live: { text: '上线', color: 'green' },
  acceptance: { text: '验收', color: 'lime' },
  maintenance: { text: '运维', color: 'gold' },
  closed: { text: '结项', color: 'default' },
};

const HEALTH_MAP: Record<string, { color: string; text: string }> = {
  green: { color: '#16a34a', text: '正常' },
  yellow: { color: '#d97706', text: '有风险' },
  red: { color: '#dc2626', text: '严重延期' },
};

export default function ProjectListPage() {
  const actionRef = useRef<ActionType>();
  const navigate = useNavigate();

  const columns: ProColumns[] = [
    { title: '项目编号', dataIndex: 'projectNo', width: 130, search: false },
    { title: '项目名称', dataIndex: 'name', ellipsis: true, width: 200, render: (_, r) => <a onClick={() => navigate(`/projects/${r.id}`)}>{r.name}</a> },
    { title: '客户', dataIndex: ['customer', 'name'], width: 150, ellipsis: true, search: false },
    { title: '阶段', dataIndex: 'stage', width: 80, valueType: 'select', fieldProps: { options: Object.entries(STAGE_MAP).map(([k, v]) => ({ label: v.text, value: k })) }, render: (_, r) => { const s = STAGE_MAP[r.stage]; return s ? <Tag color={s.color}>{s.text}</Tag> : r.stage; } },
    { title: '进度', dataIndex: 'progress', width: 120, search: false, render: (_, r) => <Progress percent={r.progress} size="small" strokeColor={r.healthStatus === 'red' ? '#dc2626' : r.healthStatus === 'yellow' ? '#d97706' : '#16a34a'} /> },
    { title: '健康', dataIndex: 'healthStatus', width: 70, search: false, render: (_, r) => { const h = HEALTH_MAP[r.healthStatus]; return h ? <Tag color={h.color}>{h.text}</Tag> : '—'; } },
    { title: '计划周期', width: 180, search: false, render: (_, r) => `${dayjs(r.plannedStartDate).format('MM-DD')} ~ ${dayjs(r.plannedEndDate).format('MM-DD')}` },
    { title: '毛利率', dataIndex: 'grossMargin', width: 80, search: false, render: (_, r) => r.grossMargin != null ? <span style={{ color: Number(r.grossMargin) < 30 ? '#dc2626' : '#16a34a' }}>{r.grossMargin}%</span> : '—' },
    { title: '状态', dataIndex: 'status', width: 80, valueType: 'select', fieldProps: { options: [{ label: '进行中', value: 'active' }, { label: '待审批', value: 'pending_approval' }, { label: '暂停', value: 'on_hold' }, { label: '已完成', value: 'completed' }] }, render: (_, r) => <Tag color={r.status === 'active' ? 'green' : r.status === 'completed' ? 'default' : 'orange'}>{r.status === 'active' ? '进行中' : r.status === 'pending_approval' ? '待审批' : r.status === 'completed' ? '已完成' : r.status}</Tag> },
  ];

  return (
    <ProTable
      headerTitle="项目交付"
      actionRef={actionRef}
      rowKey="id"
      columns={columns}
      scroll={{ x: 1300 }}
      search={{ labelWidth: 'auto', defaultCollapsed: true }}
      request={async (params) => {
        const res: any = await request.get('/projects', { params: { page: params.current, pageSize: params.pageSize, status: params.status, stage: params.stage, keyword: params.name } });
        return { data: res.items, total: res.meta.total, success: true };
      }}
      pagination={{ defaultPageSize: 20 }}
    />
  );
}

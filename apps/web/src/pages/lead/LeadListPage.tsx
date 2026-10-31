import { useRef } from 'react';
import { Tag, Space, Button } from 'antd';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import request from '../../services/request';

const STATUS_MAP: Record<string, { text: string; color: string }> = {
  new: { text: '新线索', color: 'blue' },
  cleaning: { text: '清洗中', color: 'processing' },
  qualified: { text: '合格', color: 'green' },
  unqualified: { text: '不合格', color: 'default' },
  assigned: { text: '已分配', color: 'cyan' },
  converted: { text: '已转化', color: 'success' },
  rejected: { text: '已拒绝', color: 'red' },
  expired: { text: '已过期', color: 'warning' },
};

export default function LeadListPage() {
  const actionRef = useRef<ActionType>();

  const columns: ProColumns[] = [
    { title: '编码', dataIndex: 'code', width: 120, search: false },
    { title: '企业名称', dataIndex: 'companyName', ellipsis: true, width: 200 },
    { title: '联系人', dataIndex: 'contactName', width: 80, search: false },
    { title: '来源', dataIndex: 'source', width: 90, valueType: 'select', fieldProps: { options: [{ label: '转介绍', value: 'referral' }, { label: '伙伴报备', value: 'partner' }, { label: '用友分配', value: 'yonyou_assign' }, { label: '展会', value: 'exhibition' }, { label: '官网', value: 'website' }, { label: '存量导入', value: 'import' }] } },
    { title: '评分', dataIndex: 'score', width: 80, search: false, sorter: true, render: (_, r) => {
      const color = r.score >= 60 ? '#16a34a' : r.score >= 30 ? '#d97706' : '#dc2626';
      return <span style={{ color, fontWeight: 600 }}>{r.score}</span>;
    }},
    { title: '状态', dataIndex: 'status', width: 80, valueType: 'select', fieldProps: { options: Object.entries(STATUS_MAP).map(([k, v]) => ({ label: v.text, value: k })) }, render: (_, r) => { const s = STATUS_MAP[r.status]; return s ? <Tag color={s.color}>{s.text}</Tag> : r.status; } },
    { title: '负责人', dataIndex: 'assigneeId', width: 80, search: false },
    { title: '创建时间', dataIndex: 'createdAt', width: 110, search: false, valueType: 'date' },
    { title: '操作', width: 100, search: false, fixed: 'right', render: (_, r) => (
      <Space>
        {r.status === 'assigned' && <a>转化</a>}
        {(r.status === 'new' || r.status === 'qualified') && <a>分配</a>}
      </Space>
    )},
  ];

  return (
    <ProTable
      headerTitle="线索管理"
      actionRef={actionRef}
      rowKey="id"
      columns={columns}
      scroll={{ x: 1100 }}
      search={{ labelWidth: 'auto', defaultCollapsed: true }}
      request={async (params) => {
        const res: any = await request.get('/leads', { params: { page: params.current, pageSize: params.pageSize, status: params.status, source: params.source, keyword: params.companyName } });
        return { data: res.items, total: res.meta.total, success: true };
      }}
      toolBarRender={() => [<Button key="create" type="primary">新建线索</Button>]}
      pagination={{ defaultPageSize: 20 }}
    />
  );
}

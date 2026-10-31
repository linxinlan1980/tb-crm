import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Space } from 'antd';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import request from '../../services/request';
import dayjs from 'dayjs';

export default function PoolPrivatePage() {
  const actionRef = useRef<ActionType>();
  const navigate = useNavigate();

  const columns: ProColumns[] = [
    { title: '客户名称', dataIndex: 'name', ellipsis: true, width: 200, render: (_, r) => <a onClick={() => navigate(`/customers/${r.id}`)}>{r.name}</a> },
    { title: '行业', dataIndex: 'industry', width: 100, search: false },
    { title: '级别', dataIndex: 'level', width: 80, search: false, render: (_, r) => r.level === '重点客户' ? <Tag color="blue">重点</Tag> : <Tag>普通</Tag> },
    { title: '保护期', dataIndex: 'protectUntil', width: 140, search: false, sorter: true, render: (_, r) => {
      if (!r.protectUntil) return '—';
      const days = dayjs(r.protectUntil).diff(dayjs(), 'day');
      if (days < 0) return <Tag color="red">已过期{Math.abs(days)}天</Tag>;
      if (days <= 7) return <Tag color="orange">剩余{days}天</Tag>;
      return <Tag color="green">剩余{days}天</Tag>;
    }},
    { title: '最近跟进', dataIndex: 'lastFollowAt', width: 120, search: false, render: (_, r) => r.lastFollowAt ? dayjs(r.lastFollowAt).fromNow?.() || dayjs(r.lastFollowAt).format('MM-DD HH:mm') : <span style={{ color: '#dc2626' }}>未跟进</span> },
    { title: '合同额', dataIndex: 'contractAmount', width: 100, search: false, render: (_, r) => r.contractAmount > 0 ? `¥${(r.contractAmount / 10000).toFixed(1)}万` : '—' },
    { title: '操作', width: 120, search: false, fixed: 'right', render: (_, r) => <Space><a onClick={() => navigate(`/customers/${r.id}`)}>详情</a></Space> },
  ];

  return (
    <ProTable
      headerTitle="我的私海"
      actionRef={actionRef}
      rowKey="id"
      columns={columns}
      scroll={{ x: 1000 }}
      search={{ labelWidth: 'auto', defaultCollapsed: true, filterType: 'light' }}
      request={async (params) => {
        const res: any = await request.get('/pool/private', { params: { page: params.current, pageSize: params.pageSize, keyword: params.name } });
        return { data: res.items, total: res.meta.total, success: true };
      }}
      pagination={{ defaultPageSize: 20 }}
      toolBarRender={() => [<span key="tip" style={{ fontSize: 12, color: '#64748b' }}>保护期内请保持跟进，超期将自动回收至公海</span>]}
    />
  );
}

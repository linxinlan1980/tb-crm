import { useRef } from 'react';
import { Tag } from 'antd';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import request from '../../services/request';

const STATUS_MAP: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  pending_approval: { text: '审批中', color: 'processing' },
  approved: { text: '已审批', color: 'cyan' },
  confirmed: { text: '已确认', color: 'blue' },
  shipping: { text: '交付中', color: 'orange' },
  delivered: { text: '已到货', color: 'lime' },
  completed: { text: '已完成', color: 'success' },
  cancelled: { text: '已取消', color: 'default' },
};

export default function OrderListPage() {
  const actionRef = useRef<ActionType>();

  const columns: ProColumns[] = [
    { title: '订单号', dataIndex: 'orderNo', width: 130, search: false },
    { title: '客户', dataIndex: ['customer', 'name'], width: 160, ellipsis: true, search: false },
    { title: '合同', dataIndex: ['contract', 'contractNo'], width: 130, search: false },
    { title: '金额(含税)', dataIndex: 'totalAmountInclTax', width: 120, search: false, render: (_, r) => `¥${Number(r.totalAmountInclTax).toLocaleString()}` },
    { title: '下单日期', dataIndex: 'orderDate', width: 110, search: false, valueType: 'date' },
    { title: '交付方式', dataIndex: 'deliveryMethod', width: 80, search: false, render: (_, r) => (({ online: '在线', express: '快递', onsite: '现场', email: '邮件' } as Record<string, string>)[r.deliveryMethod] || '—') },
    { title: '信用校验', dataIndex: 'creditCheckResult', width: 90, search: false, render: (_, r) => r.creditCheckResult === 'pass' ? <Tag color="green">通过</Tag> : r.creditCheckResult === 'override' ? <Tag color="orange">特批</Tag> : r.creditCheckResult === 'blocked' ? <Tag color="red">拦截</Tag> : '—' },
    { title: '用友同步', dataIndex: 'yonyouSyncStatus', width: 90, search: false, render: (_, r) => r.yonyouSyncStatus === 'synced' ? <Tag color="green">已同步</Tag> : r.yonyouSyncStatus === 'failed' ? <Tag color="red">失败</Tag> : <Tag>待同步</Tag> },
    { title: '状态', dataIndex: 'status', width: 90, valueType: 'select', fieldProps: { options: Object.entries(STATUS_MAP).map(([k, v]) => ({ label: v.text, value: k })) }, render: (_, r) => { const s = STATUS_MAP[r.status]; return s ? <Tag color={s.color}>{s.text}</Tag> : r.status; } },
  ];

  return (
    <ProTable
      headerTitle="订单管理"
      actionRef={actionRef}
      rowKey="id"
      columns={columns}
      scroll={{ x: 1200 }}
      search={{ labelWidth: 'auto', defaultCollapsed: true }}
      request={async (params) => {
        const res: any = await request.get('/orders', { params: { page: params.current, pageSize: params.pageSize, status: params.status } });
        return { data: res.items, total: res.meta.total, success: true };
      }}
      pagination={{ defaultPageSize: 20 }}
    />
  );
}

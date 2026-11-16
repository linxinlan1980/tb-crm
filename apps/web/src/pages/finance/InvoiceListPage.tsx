import { useRef } from 'react';
import { Tag, Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import request from '../../services/request';

const STATUS_MAP: Record<string, { text: string; color: string }> = {
  pending: { text: '待开票', color: 'default' },
  invoiced: { text: '已开票', color: 'blue' },
  sent: { text: '已寄出', color: 'cyan' },
  received: { text: '已签收', color: 'lime' },
  verified: { text: '已查验', color: 'success' },
  voided: { text: '已作废', color: 'default' },
  red_flushed: { text: '已红冲', color: 'red' },
};

export default function InvoiceListPage() {
  const actionRef = useRef<ActionType>();

  const columns: ProColumns[] = [
    { title: '发票编号', dataIndex: 'invoiceNo', width: 130, search: false },
    { title: '客户', dataIndex: 'invoiceTitle', width: 180, ellipsis: true },
    { title: '合同', dataIndex: ['contract', 'contractNo'], width: 130, search: false },
    { title: '金额', dataIndex: 'amount', width: 110, search: false, render: (_, r) => `¥${Number(r.amount).toLocaleString()}` },
    { title: '类型', dataIndex: 'invoiceType', width: 80, search: false, render: (_, r) => (({ special: '专票', normal: '普票', electronic: '电子' } as Record<string, string>)[r.invoiceType] || r.invoiceType) },
    { title: '实际发票号', dataIndex: 'realInvoiceNo', width: 150, search: false, ellipsis: true },
    { title: '开票日期', dataIndex: 'invoiceDate', width: 110, search: false, valueType: 'date' },
    { title: '查验', dataIndex: 'verifyResult', width: 70, search: false, render: (_, r) => r.verifyResult === 'valid' ? <Tag color="green">真</Tag> : r.verifyResult === 'invalid' ? <Tag color="red">假</Tag> : r.verifyResult ? <Tag color="orange">查无</Tag> : '—' },
    { title: '状态', dataIndex: 'status', width: 90, valueType: 'select', fieldProps: { options: Object.entries(STATUS_MAP).map(([k, v]) => ({ label: v.text, value: k })) }, render: (_, r) => { const s = STATUS_MAP[r.status]; return s ? <Tag color={s.color}>{s.text}</Tag> : r.status; } },
  ];

  return (
    <ProTable
      headerTitle="发票管理"
      actionRef={actionRef}
      rowKey="id"
      columns={columns}
      scroll={{ x: 1200 }}
      search={{ labelWidth: 'auto', defaultCollapsed: true }}
      request={async (params) => {
        const res: any = await request.get('/invoices', { params: { page: params.current, pageSize: params.pageSize, status: params.status, keyword: params.invoiceTitle } });
        return { data: res.items, total: res.meta.total, success: true };
      }}
      toolBarRender={() => [<Button key="create" type="primary" icon={<PlusOutlined />}>开票申请</Button>]}
      pagination={{ defaultPageSize: 20 }}
    />
  );
}

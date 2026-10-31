import { useRef } from 'react';
import { Button, Tag, message } from 'antd';
import { UserAddOutlined } from '@ant-design/icons';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import request from '../../services/request';

export default function PoolPublicPage() {
  const actionRef = useRef<ActionType>();

  const handleClaim = async (customerId: number) => {
    try {
      const res: any = await request.post('/pool/claim', { customerId });
      message.success(`已领取客户：${res.customerName}，保护期至${res.protectUntil?.slice(0, 10)}`);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err?.message || '领取失败');
    }
  };

  const columns: ProColumns[] = [
    { title: '客户名称', dataIndex: 'name', ellipsis: true, width: 200 },
    { title: '行业', dataIndex: 'industry', width: 100, valueType: 'select', fieldProps: { options: [{ label: '制造/工业', value: '制造/工业' }, { label: '期货/金融', value: '期货/金融' }, { label: '医院/医疗', value: '医院/医疗' }, { label: '餐饮', value: '餐饮' }, { label: 'IT/互联网', value: 'IT/互联网' }, { label: '其他', value: '其他' }] } },
    { title: '级别', dataIndex: 'level', width: 80, search: false, render: (_, r) => r.level === '重点客户' ? <Tag color="blue">重点</Tag> : <Tag>普通</Tag> },
    { title: '合同历史', dataIndex: 'contractAmount', width: 100, search: false, render: (_, r) => r.contractAmount > 0 ? `¥${(r.contractAmount / 10000).toFixed(1)}万` : '—' },
    { title: '用友产品', dataIndex: 'yonyouProduct', width: 80, search: false },
    { title: '进入公海时间', dataIndex: 'updatedAt', width: 120, search: false, valueType: 'date' },
    { title: '操作', width: 80, search: false, fixed: 'right', render: (_, r) => <Button type="link" size="small" icon={<UserAddOutlined />} onClick={() => handleClaim(r.id)}>领取</Button> },
  ];

  return (
    <ProTable
      headerTitle="公海客户"
      actionRef={actionRef}
      rowKey="id"
      columns={columns}
      scroll={{ x: 900 }}
      search={{ labelWidth: 'auto', defaultCollapsed: true }}
      request={async (params) => {
        const res: any = await request.get('/pool/public', { params: { page: params.current, pageSize: params.pageSize, keyword: params.name, industry: params.industry } });
        return { data: res.items, total: res.meta.total, success: true };
      }}
      pagination={{ defaultPageSize: 20 }}
    />
  );
}

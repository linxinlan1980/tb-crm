import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Tag, Space } from 'antd';
import { PlusOutlined, UploadOutlined, ExportOutlined } from '@ant-design/icons';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { customerApi } from '../../services/customer.api';
import dayjs from 'dayjs';

const POOL_MAP: Record<string, { text: string; color: string }> = {
  public: { text: '公海', color: 'default' },
  dept: { text: '部门池', color: 'processing' },
  private: { text: '私海', color: 'success' },
};

const LEVEL_MAP: Record<string, { text: string; color: string }> = {
  '重点客户': { text: '重点', color: 'blue' },
  '普通客户': { text: '普通', color: 'default' },
  '潜在客户': { text: '潜在', color: 'green' },
};

export default function CustomerListPage() {
  const actionRef = useRef<ActionType>();
  const navigate = useNavigate();

  const columns: ProColumns[] = [
    { title: '编码', dataIndex: 'code', width: 130, search: false },
    { title: '客户名称', dataIndex: 'name', ellipsis: true, width: 220, render: (_, r) => <a onClick={() => navigate(`/customers/${r.id}`)}>{r.name}</a> },
    { title: '行业', dataIndex: 'industry', width: 100, valueType: 'select', fieldProps: { options: [{ label: '制造/工业', value: '制造/工业' }, { label: '期货/金融', value: '期货/金融' }, { label: '医院/医疗', value: '医院/医疗' }, { label: '餐饮', value: '餐饮' }, { label: 'IT/互联网', value: 'IT/互联网' }, { label: '建筑/房地产', value: '建筑/房地产' }, { label: '其他', value: '其他' }] } },
    { title: '级别', dataIndex: 'level', width: 80, render: (_, r) => { const l = LEVEL_MAP[r.level]; return l ? <Tag color={l.color}>{l.text}</Tag> : '—'; } },
    { title: '池', dataIndex: 'poolType', width: 70, search: false, render: (_, r) => { const p = POOL_MAP[r.poolType]; return p ? <Tag color={p.color}>{p.text}</Tag> : '—'; } },
    { title: '负责人', dataIndex: 'ownerName', width: 80, search: false },
    { title: '最近跟进', dataIndex: 'lastFollowAt', width: 110, search: false, sorter: true, render: (_, r) => r.lastFollowAt ? dayjs(r.lastFollowAt).format('MM-DD HH:mm') : <span style={{ color: '#dc2626' }}>未跟进</span> },
    { title: '合同额', dataIndex: 'contractAmount', width: 100, search: false, sorter: true, render: (_, r) => r.contractAmount > 0 ? `¥${(r.contractAmount / 10000).toFixed(1)}万` : '—' },
    { title: '用友产品', dataIndex: 'yonyouProduct', width: 80, search: false },
    { title: '状态', dataIndex: 'status', width: 70, search: false, render: (_, r) => <Tag color={r.status === 'active' ? 'green' : r.status === 'churned' ? 'red' : 'default'}>{r.status === 'active' ? '活跃' : r.status === 'churned' ? '流失' : '停用'}</Tag> },
    { title: '操作', width: 100, search: false, fixed: 'right', render: (_, r) => <Space><a onClick={() => navigate(`/customers/${r.id}`)}>详情</a></Space> },
  ];

  return (
    <ProTable
      headerTitle="客户管理"
      actionRef={actionRef}
      rowKey="id"
      columns={columns}
      scroll={{ x: 1200 }}
      search={{ labelWidth: 'auto', defaultCollapsed: true }}
      request={async (params) => {
        const res: any = await customerApi.list({ page: params.current, pageSize: params.pageSize, keyword: params.name, industry: params.industry, level: params.level, sort: params.sort || 'lastFollowAt', order: (params.order === 'ascend' ? 'asc' : 'desc') as any });
        return { data: res.items, total: res.meta.total, success: true };
      }}
      toolBarRender={() => [
        <Button key="create" type="primary" icon={<PlusOutlined />} onClick={() => navigate('/customers/new')}>新建客户</Button>,
        <Button key="import" icon={<UploadOutlined />}>导入</Button>,
        <Button key="export" icon={<ExportOutlined />}>导出</Button>,
      ]}
      pagination={{ defaultPageSize: 20, showSizeChanger: true }}
    />
  );
}

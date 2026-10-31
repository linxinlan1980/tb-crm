import { useState, useEffect } from 'react';
import { Card, List, Tag, Button, Space, Tabs, Badge, Empty, Modal, Input, message } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import request from '../../services/request';
import dayjs from 'dayjs';

export default function ApprovalCenterPage() {
  const [pendingList, setPendingList] = useState<any[]>([]);
  const [myInitiated, setMyInitiated] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectModal, setRejectModal] = useState<{ visible: boolean; approvalId: number; nodeId: number }>({ visible: false, approvalId: 0, nodeId: 0 });
  const [rejectComment, setRejectComment] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [pending, initiated]: any[] = await Promise.all([
        request.get('/approvals/pending'),
        request.get('/approvals/my-initiated', { params: { pageSize: 20 } }),
      ]);
      setPendingList(pending || []);
      setMyInitiated(initiated?.items || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const handleApprove = async (approvalId: number, nodeId: number) => {
    await request.post(`/approvals/${approvalId}/nodes/${nodeId}/approve`, { comment: '同意' });
    message.success('审批通过');
    loadData();
  };

  const handleReject = async () => {
    if (!rejectComment.trim()) { message.warning('请填写驳回原因'); return; }
    await request.post(`/approvals/${rejectModal.approvalId}/nodes/${rejectModal.nodeId}/reject`, { comment: rejectComment });
    message.success('已驳回');
    setRejectModal({ visible: false, approvalId: 0, nodeId: 0 });
    setRejectComment('');
    loadData();
  };

  const BIZ_TYPE_MAP: Record<string, string> = { contract: '合同', order: '订单', invoice: '开票', project_initiation: '立项', discount: '折扣', contract_change: '合同变更', terminate: '终止' };
  const STATUS_MAP: Record<string, { text: string; color: string }> = { pending: { text: '审批中', color: 'processing' }, approved: { text: '已通过', color: 'success' }, rejected: { text: '已驳回', color: 'error' }, withdrawn: { text: '已撤回', color: 'default' }, cancelled: { text: '已取消', color: 'default' } };

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>审批中心</h2>
      <Tabs defaultActiveKey="pending" items={[
        {
          key: 'pending',
          label: <Badge count={pendingList.length} offset={[10, 0]}>待我审批</Badge>,
          children: pendingList.length === 0 ? <Empty description="暂无待审批事项" /> : (
            <List loading={loading} dataSource={pendingList} renderItem={(item: any) => (
              <Card size="small" style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Space>
                      <Tag color="blue">{BIZ_TYPE_MAP[item.approval?.bizType] || item.approval?.bizType}</Tag>
                      <strong>{item.approval?.title}</strong>
                    </Space>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                      编号：{item.approval?.approvalNo} · 节点：{item.nodeName} · 提交时间：{dayjs(item.approval?.startedAt).format('MM-DD HH:mm')}
                    </div>
                  </div>
                  <Space>
                    <Button type="primary" size="small" icon={<CheckCircleOutlined />} onClick={() => handleApprove(item.approval.id, item.nodeId)}>通过</Button>
                    <Button danger size="small" icon={<CloseCircleOutlined />} onClick={() => setRejectModal({ visible: true, approvalId: item.approval.id, nodeId: item.nodeId })}>驳回</Button>
                  </Space>
                </div>
              </Card>
            )} />
          ),
        },
        {
          key: 'initiated',
          label: '我发起的',
          children: <List loading={loading} dataSource={myInitiated} renderItem={(item: any) => {
            const s = STATUS_MAP[item.status] || { text: item.status, color: 'default' };
            return (
              <Card size="small" style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space>
                    <Tag color="blue">{BIZ_TYPE_MAP[item.bizType] || item.bizType}</Tag>
                    <span>{item.title}</span>
                    <Tag color={s.color}>{s.text}</Tag>
                  </Space>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{dayjs(item.createdAt).format('YYYY-MM-DD HH:mm')}</span>
                </div>
              </Card>
            );
          }} />
        },
      ]} />

      <Modal title="驳回原因" open={rejectModal.visible} onOk={handleReject} onCancel={() => setRejectModal({ visible: false, approvalId: 0, nodeId: 0 })} okText="确认驳回" okButtonProps={{ danger: true }}>
        <Input.TextArea rows={3} value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} placeholder="请填写驳回原因（必填）" />
      </Modal>
    </div>
  );
}

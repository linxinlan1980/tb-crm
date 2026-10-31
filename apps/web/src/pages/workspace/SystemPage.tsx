import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Select, Table, Tag, Tabs, Typography, message } from 'antd';
import { get, post, put, errorText, type RecordRow } from '../../services/workspace';
export default function SystemPage() {
  const [users, setUsers] = useState<RecordRow[]>([]),
    [roles, setRoles] = useState<RecordRow[]>([]),
    [depts, setDepts] = useState<RecordRow[]>([]),
    [audit, setAudit] = useState<RecordRow[]>([]),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState<RecordRow>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [form] = Form.useForm();
  const load = async () => {
    try {
      const [u, r, d, a] = await Promise.all([
        get<{ items: RecordRow[] }>('/system/users', { pageSize: 100 }),
        get<RecordRow[]>('/system/roles'),
        get<RecordRow[]>('/system/departments/tree'),
        get<{ items: RecordRow[] }>('/system/audit-logs', { pageSize: 50 }),
      ]);
      setUsers(u.items);
      setRoles(r);
      setDepts(d);
      setAudit(a.items);
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const edit = (u?: RecordRow) => {
    setEditing(u);
    form.resetFields();
    if (u)
      form.setFieldsValue({
        name: u.name,
        username: u.username,
        deptId: (u.dept as RecordRow)?.id,
        roleIds: (u.roles as RecordRow[]).map((r) => r.id),
      });
    setOpen(true);
  };
  const save = async () => {
    try {
      const data = await form.validateFields();
      setBusy(true);
      if (editing) {
        delete data.username;
        delete data.password;
        await put(`/system/users/${editing.id}`, data);
      } else await post('/system/users', data);
      setOpen(false);
      message.success('用户已保存');
      await load();
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMINISTRATION</div>
          <h1>系统管理</h1>
          <Typography.Text type="secondary">管理员维护账号与组织，权限变更在后续请求中生效。</Typography.Text>
        </div>
        <Button type="primary" onClick={() => edit()}>
          新建用户
        </Button>
      </div>
      {error && <Alert message={error} type="error" showIcon />}
      <Tabs
        items={[
          {
            key: 'users',
            label: '用户账号',
            children: (
              <Card>
                <Table
                  rowKey="id"
                  dataSource={users}
                  columns={[
                    { title: '账号', dataIndex: 'username' },
                    { title: '姓名', dataIndex: 'name' },
                    { title: '部门', dataIndex: 'dept', render: (v) => v?.name ?? '—' },
                    {
                      title: '角色',
                      dataIndex: 'roles',
                      render: (v: RecordRow[]) => v.map((r) => <Tag key={r.id}>{String(r.name)}</Tag>),
                    },
                    { title: '状态', dataIndex: 'status' },
                    {
                      title: '操作',
                      render: (_, r) => (
                        <Button type="link" onClick={() => edit(r)}>
                          编辑
                        </Button>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'roles',
            label: '角色权限',
            children: (
              <Card>
                <Table
                  rowKey="id"
                  dataSource={roles}
                  columns={[
                    { title: '角色', dataIndex: 'name' },
                    { title: '编码', dataIndex: 'code' },
                    { title: '数据范围', dataIndex: 'dataScope' },
                    {
                      title: '权限',
                      dataIndex: 'permissions',
                      render: (v: string[]) => v?.map((p) => <Tag key={p}>{p}</Tag>),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'departments',
            label: '组织部门',
            children: (
              <Card>
                <Table
                  rowKey="id"
                  dataSource={depts}
                  pagination={false}
                  columns={[
                    { title: '部门', dataIndex: 'name' },
                    { title: '编码', dataIndex: 'code' },
                    { title: '负责人编号', dataIndex: 'leaderId' },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'audit',
            label: '业务审计',
            children: (
              <Card>
                <Table
                  rowKey="id"
                  dataSource={audit}
                  columns={[
                    { title: '操作', dataIndex: 'action' },
                    { title: '对象', dataIndex: 'objectType' },
                    { title: '操作人', dataIndex: 'userId' },
                    { title: '时间', dataIndex: 'createdAt', render: (v) => String(v).replace('T', ' ').slice(0, 19) },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />
      <Modal
        title={editing ? '编辑用户' : '新建用户'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        confirmLoading={busy}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="username" label="账号" rules={[{ required: true }]}>
            <Input disabled={!!editing} />
          </Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {!editing && (
            <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 12 }]}>
              <Input.Password />
            </Form.Item>
          )}
          <Form.Item name="deptId" label="部门">
            <Select options={depts.map((d) => ({ value: d.id, label: String(d.name) }))} />
          </Form.Item>
          <Form.Item name="roleIds" label="角色" rules={[{ required: true }]}>
            <Select mode="multiple" options={roles.map((r) => ({ value: r.id, label: String(r.name) }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

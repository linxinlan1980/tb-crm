import { useEffect,useState } from 'react';
import { Alert,Button,Card,DatePicker,Form,Select,Space,Switch,message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import {get,post,key,errorText}from '../../services/workspace';
interface Policy{enabled:boolean;notifyUserIds:number[];contractFlowId:number;autoSubmitContracts:boolean;fromDate:string}
interface State{configured:boolean;policy:Policy|null;updatedAt:string|null;users:{id:number;name:string}[];flows:{id:number;name:string}[]}
export default function BusinessRulesPage(){
  const [data,setData]=useState<State>(),[busy,setBusy]=useState(false),[form]=Form.useForm<Omit<Policy,'fromDate'>&{fromDate:Dayjs}>();
  async function load(){try{const r=await get<State>('/business-rules');setData(r);form.setFieldsValue(r.policy?{...r.policy,fromDate:dayjs(r.policy.fromDate)}:{enabled:false,notifyUserIds:[],autoSubmitContracts:true,fromDate:dayjs()});}catch(e){void message.error(errorText(e));}}
  useEffect(()=>{void load();},[]);
  async function save(){try{const v=await form.validateFields();setBusy(true);await post('/business-rules',{requestKey:key(),expectedUpdatedAt:data?.updatedAt,data:{...v,fromDate:v.fromDate.format('YYYY-MM-DD')}});message.success('业务规则已保存');await load();}catch(e){void message.error(errorText(e));}finally{setBusy(false);}}
  return <div><div className="page-heading"><h1>商机提醒与合同审批规则</h1><Button onClick={()=>void load()}>刷新</Button></div>
    <Alert showIcon type="info" style={{marginBottom:16}} message="仅影响启用后的新建业务。商机通过站内通知提醒，合同使用通用审批流；历史补录不发通知。钉钉原生审批连接另在钉钉设置中配置。" />
    {!data?.configured&&<Alert type="warning" message="本机尚未启用此公司业务规则开关，保存配置不会自动外发。" style={{marginBottom:16}}/>}
    <Card title="内部规则"><Form form={form} layout="vertical" style={{maxWidth:680}}>
      <Form.Item name="enabled" label="启用内部业务规则" valuePropName="checked"><Switch/></Form.Item>
      <Form.Item name="notifyUserIds" label="新建商机通知人员" rules={[{required:true}]}><Select mode="multiple" maxCount={8} options={data?.users.map(u=>({value:u.id,label:u.name}))}/></Form.Item>
      <Form.Item name="autoSubmitContracts" label="新建合同立即发起审批" valuePropName="checked"><Switch/></Form.Item>
      <Form.Item name="contractFlowId" label="使用已发布的合同审批流" rules={[{required:true}]}><Select options={data?.flows.map(f=>({value:f.id,label:f.name}))}/></Form.Item>
      <Form.Item name="fromDate" label="生效日期" rules={[{required:true}]}><DatePicker minDate={dayjs('2010-01-01')} maxDate={dayjs('2060-12-31')}/></Form.Item>

      <Space wrap><Button type="primary" loading={busy} onClick={()=>void save()}>保存规则</Button><Button href="/approval-designer">查看审批设计器</Button></Space>
    </Form></Card>
  </div>;
}

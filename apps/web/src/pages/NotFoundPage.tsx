import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';
export default function NotFoundPage() {
  const navigate = useNavigate();
  return <Result status="404" title="页面暂不可用" subTitle="请返回工作台选择可用功能。"
    extra={<Button type="primary" onClick={() => navigate('/dashboard')}>返回工作台</Button>} />;
}

import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';

interface LoginValues {
  username: string;
  password: string;
}

export function Login({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (values: LoginValues) => {
    setBusy(true);
    setError('');
    try {
      await onLogin(values.username, values.password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <Card className="login-panel">
        <Typography.Title level={1}>Team 管理</Typography.Title>
        <Typography.Paragraph type="secondary">登录后管理母号、子号和 Codex 凭证。</Typography.Paragraph>
        <Form<LoginValues>
          layout="vertical"
          initialValues={{ username: 'admin', password: '' }}
          onFinish={submit}
          disabled={busy}
        >
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          {error && <Alert className="login-error" type="error" showIcon message={error} />}
          <Button type="primary" htmlType="submit" loading={busy} block>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}

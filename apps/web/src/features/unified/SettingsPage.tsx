import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Switch, Table, Typography } from 'antd';
import { unifiedApi } from '../../unifiedApi.js';

export function SettingsPage() {
  const [policies, setPolicies] = useState<any[]>([]); const [error, setError] = useState('');
  const load = () => unifiedApi.notificationPolicies().then(setPolicies).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  return <Card><Typography.Title level={2}>系统设置</Typography.Title><Typography.Paragraph type="secondary">通知策略配置存入 PostgreSQL；需要秘密的渠道值应由部署环境提供，页面只管理非秘密策略参数。</Typography.Paragraph>{error && <Alert type="error" message={error} />}<Table rowKey="kind" pagination={false} dataSource={policies} columns={[{ title: '策略', dataIndex: 'kind' }, { title: '启用', dataIndex: 'enabled', render: (value) => value ? '是' : '否' }, { title: '配置', dataIndex: 'configuration', render: (value) => <pre>{JSON.stringify(value, null, 2)}</pre> }]} /><Space direction="vertical" style={{ width: '100%', marginTop: 16 }}><Typography.Title level={4}>新增或修改策略</Typography.Title><Form layout="inline" onFinish={async (value) => { let configuration = {}; try { configuration = value.configuration ? JSON.parse(value.configuration) : {}; } catch { setError('配置必须是 JSON 对象'); return; } await unifiedApi.saveNotificationPolicy(value.kind, { enabled: value.enabled === true, configuration }); await load(); }}><Form.Item name="kind" label="策略键" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="enabled" valuePropName="checked"><Switch /></Form.Item><Form.Item name="configuration" label="配置 JSON"><Input.TextArea rows={3} /></Form.Item><Button htmlType="submit" type="primary">保存</Button></Form></Space></Card>;
}

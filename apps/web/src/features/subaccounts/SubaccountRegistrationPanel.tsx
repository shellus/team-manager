import type { SubaccountView } from '@team-manager/shared';
import { Card, Descriptions, Empty, Typography } from 'antd';
import { formatDateTime } from '../../components/format.js';

export function SubaccountRegistrationPanel({ subaccount }: { subaccount: SubaccountView }) {
  if (!subaccount.registrationPassword && !subaccount.registeredAt && !subaccount.registrationSource) {
    return (
      <Card>
        <Empty description="该子号不是由自动注册流程创建" />
      </Card>
    );
  }

  return (
    <Card title="自动注册资料">
      <Descriptions column={{ xs: 1, md: 2 }} bordered size="small">
        <Descriptions.Item label="注册邮箱">
          <Typography.Text copyable>{subaccount.email}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="登录密码">
          {subaccount.registrationPassword ? (
            <Typography.Text code copyable={{ text: subaccount.registrationPassword }}>
              {subaccount.registrationPassword}
            </Typography.Text>
          ) : '暂无'}
        </Descriptions.Item>
        <Descriptions.Item label="注册时间">{formatDateTime(subaccount.registeredAt)}</Descriptions.Item>
        <Descriptions.Item label="注册来源">
          {subaccount.registrationMethod === 'cloak_browser'
            ? 'CloakBrowser + GongXi-Mail'
            : subaccount.registrationSource?.startsWith('gongxi')
              ? 'GongXi-Mail'
            : subaccount.registrationSource || '自动注册'}
        </Descriptions.Item>
        <Descriptions.Item label="浏览器 Profile">
          {subaccount.cloakProfileName || subaccount.cloakProfileId ? (
            <Typography.Text copyable={{ text: subaccount.cloakProfileId }}>
              {subaccount.cloakProfileName || subaccount.cloakProfileId}
            </Typography.Text>
          ) : '暂无'}
        </Descriptions.Item>
        <Descriptions.Item label="Profile ID">
          {subaccount.cloakProfileId ? (
            <Typography.Text code copyable>{subaccount.cloakProfileId}</Typography.Text>
          ) : '暂无'}
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

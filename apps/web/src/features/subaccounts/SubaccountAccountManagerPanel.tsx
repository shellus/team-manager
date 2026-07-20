import type { SubaccountView } from '@team-manager/shared';
import { Card, Descriptions, Empty, Typography } from 'antd';

export function SubaccountAccountManagerPanel({ subaccount }: { subaccount: SubaccountView }) {
  if (!subaccount.managedAccountEmail) {
    return (
      <Card>
        <Empty description="该子号独立录入，未关联 GPT Account Manager" />
      </Card>
    );
  }

  return (
    <Card title="GPT Account Manager 关联">
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="账号引用">
          <Typography.Text code copyable>{subaccount.managedAccountEmail}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="数据边界">
          Team Manager 仅保存业务所需的 Web Session；注册密码与 CloakBrowser Profile 由 GPT Account Manager 管理。
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

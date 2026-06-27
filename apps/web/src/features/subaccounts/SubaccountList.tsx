import type { CodexAuthRuntimeStatus, SubaccountView } from '@team-manager/shared';
import {
  DeleteOutlined,
  EditOutlined,
  FileProtectOutlined,
  MoreOutlined,
  PlusOutlined,
  RobotOutlined
} from '@ant-design/icons';
import { Button, Card, Dropdown, List, Space, Typography } from 'antd';
import { SubaccountStatusTag } from '../../components/StatusTag.js';
import { formatDateTime, shortText } from '../../components/format.js';

export function SubaccountList({
  subaccounts,
  selectedId,
  runtimeStatus,
  busy,
  onSelect,
  onOpenImportSession,
  onOpenImportCredential,
  onOpenRegister,
  onOpenEdit,
  onOpenDelete
}: {
  subaccounts: SubaccountView[];
  selectedId: string;
  runtimeStatus: CodexAuthRuntimeStatus | null;
  busy: string;
  onSelect: (subaccount: SubaccountView) => void;
  onOpenImportSession: () => void;
  onOpenImportCredential: () => void;
  onOpenRegister: () => void;
  onOpenEdit: (subaccount: SubaccountView) => void;
  onOpenDelete: (subaccount: SubaccountView) => void;
}) {
  return (
    <div className="side-pane">
      <div className="pane-title">
        <div>
          <Typography.Title level={2}>子号</Typography.Title>
          <Typography.Text type="secondary">{subaccounts.length} 个账号</Typography.Text>
        </div>
      </div>
      <div className="side-actions">
        <Button
          type="primary"
          icon={<RobotOutlined />}
          loading={busy === 'register-subaccount'}
          disabled={runtimeStatus?.subaccountRegistration === false}
          onClick={onOpenRegister}
        >
          自动注册
        </Button>
        <Button icon={<PlusOutlined />} onClick={onOpenImportSession}>
          录入子号
        </Button>
        <Button icon={<FileProtectOutlined />} onClick={onOpenImportCredential}>
          导入凭证
        </Button>
      </div>
      <List
        className="record-list"
        dataSource={subaccounts}
        locale={{ emptyText: '还没有子号' }}
        renderItem={(subaccount) => {
          const selected = selectedId === subaccount.id;
          const title = subaccount.remark || subaccount.email;
          const repeatedEmail = title.trim().toLowerCase() === subaccount.email.trim().toLowerCase();
          return (
            <List.Item>
              <Card
                size="small"
                hoverable
                className={selected ? 'record-card selected' : 'record-card'}
                onClick={() => onSelect(subaccount)}
              >
                <div className="record-card-head">
                  <div className="record-title">
                    <Typography.Text strong ellipsis={{ tooltip: title }}>
                      {title}
                    </Typography.Text>
                    {!repeatedEmail && (
                      <Typography.Text type="secondary" ellipsis={{ tooltip: subaccount.email }}>
                        {subaccount.email}
                      </Typography.Text>
                    )}
                  </div>
                  <Space size={4}>
                    <SubaccountStatusTag status={subaccount.status} />
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          {
                            key: 'edit',
                            icon: <EditOutlined />,
                            label: '编辑本地资料',
                            onClick: () => onOpenEdit(subaccount)
                          },
                          {
                            key: 'delete',
                            danger: true,
                            icon: <DeleteOutlined />,
                            label: '删除子号',
                            onClick: () => onOpenDelete(subaccount)
                          }
                        ]
                      }}
                    >
                      <Button
                        aria-label="更多操作"
                        icon={<MoreOutlined />}
                        size="small"
                        type="text"
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  </Space>
                </div>
                <div className="record-meta">
                  <span>{subaccount.hasWebSession ? 'Web Session 已录入' : '无 Web Session'}</span>
                  <span>Codex 凭证 {subaccount.codexCredentials.length} 份</span>
                </div>
                <div className="record-meta muted">
                  <span>更新 {formatDateTime(subaccount.updatedAt)}</span>
                </div>
                {subaccount.lastError && (
                  <Typography.Text className="record-error" type="danger" title={subaccount.lastError}>
                    {shortText(subaccount.lastError, 96)}
                  </Typography.Text>
                )}
              </Card>
            </List.Item>
          );
        }}
      />
    </div>
  );
}

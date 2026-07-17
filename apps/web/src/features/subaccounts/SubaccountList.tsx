import type {
  CodexAuthRuntimeStatus,
  SubaccountRegistrationJobView,
  SubaccountView
} from '@team-manager/shared';
import {
  DeleteOutlined,
  EditOutlined,
  FileProtectOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined
} from '@ant-design/icons';
import { Button, Card, Dropdown, List, Progress, Segmented, Space, Tag, Typography } from 'antd';
import { SubaccountStatusTag } from '../../components/StatusTag.js';
import { formatDateTime, shortText } from '../../components/format.js';

export function SubaccountList({
  subaccounts,
  registrationJobs,
  selectedId,
  runtimeStatus,
  isBusy,
  onSelect,
  onOpenImportSession,
  onOpenImportCredential,
  onOpenRegister,
  onRetryRegistration,
  onOpenEdit,
  onOpenDelete
}: {
  subaccounts: SubaccountView[];
  registrationJobs: SubaccountRegistrationJobView[];
  selectedId: string;
  runtimeStatus: CodexAuthRuntimeStatus | null;
  isBusy: (key: string) => boolean;
  onSelect: (subaccount: SubaccountView) => void;
  onOpenImportSession: () => void;
  onOpenImportCredential: () => void;
  onOpenRegister: () => void;
  onRetryRegistration: (job: SubaccountRegistrationJobView) => void;
  onOpenEdit: (subaccount: SubaccountView) => void;
  onOpenDelete: (subaccount: SubaccountView) => void;
}) {
  const visibleJobs = registrationJobs.filter((job) => {
    if (job.status === 'failed' || job.status === 'interrupted') return true;
    return !job.subaccountId || !subaccounts.some((subaccount) => subaccount.id === job.subaccountId);
  });
  const jobSubaccountIds = new Set(
    visibleJobs.map((job) => job.subaccountId).filter((id): id is string => Boolean(id))
  );
  const visibleSubaccounts = subaccounts.filter((subaccount) => !jobSubaccountIds.has(subaccount.id));
  const records = [
    ...visibleJobs.map((job) => ({ kind: 'job' as const, id: job.id, job })),
    ...visibleSubaccounts.map((subaccount) => ({ kind: 'subaccount' as const, id: subaccount.id, subaccount }))
  ];

  return (
    <div className="side-pane">
      <div className="side-actions">
        <Button
          type="primary"
          icon={<RobotOutlined />}
          loading={isBusy('register-subaccount')}
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
      <Segmented
        className="group-selector"
        block
        value="all"
        options={[
          {
            label: `所有 (${records.length})`,
            value: 'all'
          }
        ]}
      />
      <List
        className="record-list"
        dataSource={records}
        rowKey={(record) => `${record.kind}:${record.id}`}
        locale={{ emptyText: '还没有子号' }}
        renderItem={(record) => {
          if (record.kind === 'job') {
            const job = record.job;
            const failed = job.status === 'failed' || job.status === 'interrupted';
            return (
              <List.Item>
                <Card size="small" className="record-card registration-job-card" aria-live="polite">
                  <div className="record-card-head">
                    <div className="record-title">
                      <Typography.Text strong ellipsis={{ tooltip: job.email || '自动注册子号' }}>
                        {job.email || '正在分配邮箱'}
                      </Typography.Text>
                      <Typography.Text type="secondary">{job.message}</Typography.Text>
                    </div>
                    <Tag color={failed ? 'error' : job.status === 'queued' ? 'default' : 'processing'}>
                      {failed ? '注册失败' : job.status === 'queued' ? '排队中' : '注册中'}
                    </Tag>
                  </div>
                  <Progress
                    className="registration-job-progress"
                    percent={job.progress}
                    size="small"
                    status={failed ? 'exception' : job.status === 'succeeded' ? 'success' : 'active'}
                    format={(percent) => `${percent ?? 0}%`}
                  />
                  {job.error && (
                    <Typography.Text className="record-error" type="danger" title={job.error}>
                      {shortText(job.error, 96)}
                    </Typography.Text>
                  )}
                  {failed && (
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={isBusy(`retry-registration-${job.id}`)}
                      onClick={() => onRetryRegistration(job)}
                    >
                      {job.email ? '重试此邮箱' : '重新开始'}
                    </Button>
                  )}
                </Card>
              </List.Item>
            );
          }
          const subaccount = record.subaccount;
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

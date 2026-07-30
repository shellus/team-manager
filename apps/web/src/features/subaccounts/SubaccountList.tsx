import type {
  AccountManagerOperationView,
  SubaccountAccountManagerStatus,
  AccountManagerRuntimeStatus,
  AccountManagerProfileView,
  SubaccountRegistrationJobView,
  SubaccountSummaryView
} from '@team-manager/shared';
import {
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined
} from '@ant-design/icons';
import { Button, Card, Dropdown, List, Progress, Space, Tag, Typography } from 'antd';
import { GroupSelector } from '../../components/GroupSelector.js';
import { KeywordSearchInput } from '../../components/KeywordSearchInput.js';
import {
  ALL_LOCAL_GROUP,
  ALL_LOCAL_GROUP_LABEL,
  filterByLocalGroup,
  type LocalGroupCount
} from '../../components/recordGroups.js';
import { BannedStatusTag, SubaccountStatusTag } from '../../components/StatusTag.js';
import { formatDateTime } from '../../components/format.js';
import { RunningProfileTag } from '../../components/AccountProfileListStatus.js';
import { AccountOperationProgress } from '../../components/AccountOperationProgress.js';
import {
  RegistrationTaskCancelButton,
  registrationTaskCanCancel,
  registrationTaskIsCancelled
} from '../../components/RegistrationTaskCancelButton.js';
import { WorkspaceOpeningStatusTags } from '../../components/WorkspaceOpeningStatusTags.js';
import { hasPro5xFromLocalState } from '../../components/accountManagerLocalState.js';
import { registrationJobMatchesQuery, subaccountMatchesQuery } from './subaccountSearch.js';

function registrationJobSummary(job: SubaccountRegistrationJobView): string {
  if (registrationTaskIsCancelled(job.phase)) return '注册任务已取消，可按原邮箱重试';
  if (job.status === 'failed') return '注册未完成，可使用原邮箱和密码重试';
  if (job.status === 'interrupted') return '任务因服务重启中断，可继续重试';
  if (job.status === 'waiting_manual') {
    return job.message || '可以人工处理验证；系统会持续监听并在通过后自动继续';
  }
  return job.message;
}

export function SubaccountList({
  subaccounts,
  registrationJobs,
  accountProfileStatuses,
  accountManagerStatuses,
  groups,
  activeGroup,
  searchQuery,
  selectedId,
  selectedRegistrationId,
  runtimeStatus,
  isBusy,
  onSelect,
  onGroupChange,
  onSearchChange,
  onOpenImportSession,
  onOpenRegister,
  onRetryRegistration,
  onCancelRegistration,
  onSelectRegistration,
  onTerminateOperation,
  onDismissOperation,
  onOpenEdit,
  onOpenDelete
}: {
  subaccounts: SubaccountSummaryView[];
  registrationJobs: SubaccountRegistrationJobView[];
  accountProfileStatuses: Record<string, AccountManagerProfileView>;
  accountManagerStatuses: Record<string, SubaccountAccountManagerStatus>;
  groups: LocalGroupCount[];
  activeGroup: string;
  searchQuery: string;
  selectedId: string;
  selectedRegistrationId?: string;
  runtimeStatus: AccountManagerRuntimeStatus | null;
  isBusy: (key: string) => boolean;
  onSelect: (subaccount: SubaccountSummaryView) => void;
  onGroupChange: (group: string) => void;
  onSearchChange: (query: string) => void;
  onOpenImportSession: () => void;
  onOpenRegister: () => void;
  onRetryRegistration: (job: SubaccountRegistrationJobView) => void;
  onCancelRegistration: (job: SubaccountRegistrationJobView) => void;
  onSelectRegistration: (job: SubaccountRegistrationJobView) => void;
  onTerminateOperation: (
    subaccount: SubaccountSummaryView,
    operation: AccountManagerOperationView
  ) => void;
  onDismissOperation: (
    subaccount: SubaccountSummaryView,
    operation: AccountManagerOperationView
  ) => void;
  onOpenEdit: (subaccount: SubaccountSummaryView) => void;
  onOpenDelete: (subaccount: SubaccountSummaryView) => void;
}) {
  const subaccountById = new Map(subaccounts.map((subaccount) => [subaccount.id, subaccount]));
  const visibleJobs = registrationJobs.filter((job) => {
    if (job.status === 'succeeded') return false;
    if (job.subaccountId && !subaccountById.has(job.subaccountId)) return false;
    if (job.status === 'failed' || job.status === 'interrupted' || job.status === 'waiting_manual') {
      const linkedSubaccount = job.subaccountId ? subaccountById.get(job.subaccountId) : undefined;
      if (linkedSubaccount && linkedSubaccount.status !== 'error' && linkedSubaccount.status !== 'verification_required') {
        return false;
      }
      return true;
    }
    return !job.subaccountId || !subaccountById.has(job.subaccountId);
  });
  const jobSubaccountIds = new Set(
    visibleJobs.map((job) => job.subaccountId).filter((id): id is string => Boolean(id))
  );
  const matchingSubaccounts = subaccounts.filter((subaccount) => subaccountMatchesQuery(subaccount, searchQuery));
  const visibleSubaccounts = filterByLocalGroup(matchingSubaccounts, activeGroup)
    .filter((subaccount) => !jobSubaccountIds.has(subaccount.id));
  const matchingJobs = visibleJobs.filter((job) => registrationJobMatchesQuery(job, searchQuery));
  const records = [
    ...matchingJobs.map((job) => ({ kind: 'job' as const, id: job.id, job })),
    ...visibleSubaccounts.map((subaccount) => ({ kind: 'subaccount' as const, id: subaccount.id, subaccount }))
  ];

  return (
    <div className="side-pane">
      <div className="side-actions">
        <Button
          type="primary"
          icon={<RobotOutlined />}
          loading={isBusy('register-subaccount')}
          disabled={runtimeStatus?.configured === false || runtimeStatus?.reachable === false}
          onClick={onOpenRegister}
        >
          自动注册
        </Button>
        <Button icon={<PlusOutlined />} onClick={onOpenImportSession}>
          录入子号
        </Button>
      </div>
      <KeywordSearchInput
        placeholder="搜索子号邮箱、备注、分组或 Account Manager 引用"
        ariaLabel="搜索子号"
        value={searchQuery}
        onSearchChange={onSearchChange}
      />
      <GroupSelector
        ariaLabel="筛选子号分组"
        value={activeGroup}
        options={[
          {
            label: `${ALL_LOCAL_GROUP_LABEL} (${matchingSubaccounts.length + matchingJobs.length})`,
            value: ALL_LOCAL_GROUP
          },
          ...groups.map((group) => ({
            label: `${group.name} (${group.count})`,
            value: group.name
          }))
        ]}
        onChange={onGroupChange}
      />
      <List
        className="record-list"
        dataSource={records}
        rowKey={(record) => `${record.kind}:${record.id}`}
        locale={{ emptyText: searchQuery ? '没有匹配的子号或注册任务' : '还没有子号' }}
        renderItem={(record) => {
          if (record.kind === 'job') {
            const job = record.job;
            const failed = job.status === 'failed' || job.status === 'interrupted';
            const cancelled = registrationTaskIsCancelled(job.phase);
            const canCancel = registrationTaskCanCancel(job.status);
            const waitingManual = job.status === 'waiting_manual';
            const selected = job.id === selectedRegistrationId;
            return (
              <List.Item>
                <Card
                  size="small"
                  hoverable
                  className={`record-card registration-job-card${selected ? ' selected' : ''}`}
                  aria-live="polite"
                  onClick={() => onSelectRegistration(job)}
                >
                  <div className="record-card-head">
                    <div className="record-title">
                      <Typography.Text strong ellipsis={{ tooltip: job.email || '自动注册子号' }}>
                        {job.email || '正在分配邮箱'}
                      </Typography.Text>
                      <Typography.Text type="secondary" ellipsis={{ tooltip: registrationJobSummary(job) }}>
                        {registrationJobSummary(job)}
                      </Typography.Text>
                    </div>
                    <Tag color={cancelled ? 'default' : failed ? 'error' : waitingManual ? 'warning' : job.status === 'queued' ? 'default' : 'processing'}>
                      {cancelled
                        ? '已取消'
                        : failed
                        ? '注册失败'
                        : waitingManual
                          ? '等待人工处理'
                          : job.status === 'queued'
                            ? '排队中'
                            : '注册中'}
                    </Tag>
                  </div>
                  <Progress
                    className="registration-job-progress"
                    percent={job.progress}
                    size="small"
                    status={cancelled ? 'normal' : failed ? 'exception' : job.status === 'succeeded' ? 'success' : 'active'}
                    format={(percent) => `${percent ?? 0}%`}
                  />
                  {(failed || canCancel) && (
                    <Space wrap>
                      {failed && (
                        <Button
                          size="small"
                          icon={<ReloadOutlined />}
                          loading={isBusy(`retry-registration-${job.id}`)}
                          onClick={(event) => {
                            event.stopPropagation();
                            onRetryRegistration(job);
                          }}
                        >
                          {job.email ? '重试此邮箱' : '重新开始'}
                        </Button>
                      )}
                      {canCancel && (
                        <RegistrationTaskCancelButton
                          loading={isBusy(`cancel-registration-${job.id}`)}
                          onConfirm={() => onCancelRegistration(job)}
                        />
                      )}
                    </Space>
                  )}
                </Card>
              </List.Item>
            );
          }
          const subaccount = record.subaccount;
          const selected = selectedId === subaccount.id;
          const title = subaccount.remark || subaccount.email;
          const repeatedEmail = title.trim().toLowerCase() === subaccount.email.trim().toLowerCase();
          const managerStatus = accountManagerStatuses[subaccount.id];
          const pro5xOperation = managerStatus?.pro5xOperation;
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
                    <BannedStatusTag isBanned={subaccount.isBanned} />
                    <SubaccountStatusTag status={subaccount.status} />
                    {subaccount.lastError
                      && subaccount.status !== 'error'
                      && subaccount.status !== 'account_locked'
                      && subaccount.status !== 'verification_required' && (
                        <Tag color="warning">同步警告</Tag>
                    )}
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
                  <span>分组 {subaccount.groupName || '默认分组'}</span>
                  <span>{subaccount.hasWebSession ? 'Web Session 已录入' : '无 Web Session'}</span>
                  <span>Codex 凭证 {subaccount.codexCredentialCount} 份</span>
                </div>
                <div className="record-meta record-status-meta" aria-label="子号账号管理状态">
                  <Tag color={subaccount.managedAccountEmail ? 'blue' : 'default'}>
                    {subaccount.managedAccountEmail ? 'GAM' : '非 GAM'}
                  </Tag>
                  <RunningProfileTag profile={accountProfileStatuses[subaccount.id]} />
                  <WorkspaceOpeningStatusTags
                    hasPro5x={hasPro5xFromLocalState(
                      subaccount.accountManagerHasPro5x,
                      managerStatus?.hasPro5x
                    )}
                  />
                  <span className="record-status-time">更新 {formatDateTime(subaccount.updatedAt)}</span>
                </div>
                {pro5xOperation && pro5xOperation.status !== 'succeeded' && (
                  <AccountOperationProgress
                    label="Pro 5x"
                    operation={pro5xOperation}
                    isBusy={isBusy}
                    busyKeyScope="pro5x"
                    onTerminate={() => onTerminateOperation(subaccount, pro5xOperation)}
                    onDismiss={() => onDismissOperation(subaccount, pro5xOperation)}
                  />
                )}
              </Card>
            </List.Item>
          );
        }}
      />
    </div>
  );
}

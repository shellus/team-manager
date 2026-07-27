import type {
  AccountManagerOperationView,
  AccountManagerRuntimeStatus,
  AccountSummaryView,
  ParentAccountManagerStatus,
  ParentRegistrationTaskView
} from '@team-manager/shared';
import { MAX_CHATGPT_SEATS } from '@team-manager/shared';
import {
  CloseOutlined,
  DeleteOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  StopOutlined,
  SwapOutlined
} from '@ant-design/icons';
import { Button, Card, Dropdown, List, Popconfirm, Progress, Space, Tag, Tooltip, Typography } from 'antd';
import { formatRelativeTime, shortText } from '../../components/format.js';
import { GroupSelector } from '../../components/GroupSelector.js';
import { KeywordSearchInput } from '../../components/KeywordSearchInput.js';
import { BannedStatusTag, LimitTypeTag } from '../../components/StatusTag.js';
import { WorkspaceOpeningStatusTags } from '../../components/WorkspaceOpeningStatusTags.js';
import { ParentQuickFilterBar } from './ParentQuickFilterBar.js';
import { ALL_PARENT_GROUP, ALL_PARENT_GROUP_LABEL } from './parentGroups.js';
import {
  parentChatGptSeatUsageCount,
  parentListIdentity,
  parentMemberAndInviteCount,
  parentSeatUsageClass
} from './parentListItem.js';
import { canManageParentWorkspace, hasParentCodexSpace } from './parentWorkspaceCapability.js';
import type { ParentQuickFilter } from './parentQuickFilters.js';

function taskSummary(task: ParentRegistrationTaskView): string {
  if (task.stage === 'registration_failed') return task.error || '注册未完成，可按原邮箱重试';
  if (task.stage === 'waiting_manual') {
    return task.registration.message || '可以人工处理验证；系统会持续监听并在通过后自动继续';
  }
  if (task.stage === 'import_failed') return task.error || '账号已创建，但录入母号失败';
  return task.registration.message || '正在自动注册账号';
}

function taskProgress(task: ParentRegistrationTaskView): number {
  return task.registration.progress;
}

type ParentWorkspaceOperation = {
  label: '0.52' | '双席位';
  operation: AccountManagerOperationView;
};

function visibleWorkspaceOperation(status?: ParentAccountManagerStatus): ParentWorkspaceOperation | undefined {
  const operations: ParentWorkspaceOperation[] = [
    ...(status?.codexOperation ? [{ label: '0.52' as const, operation: status.codexOperation }] : []),
    ...(status?.teamOperation ? [{ label: '双席位' as const, operation: status.teamOperation }] : [])
  ].filter(({ operation }) => operation.status !== 'succeeded');
  const active = (operation: AccountManagerOperationView) =>
    ['queued', 'running', 'waiting_for_otp', 'waiting_manual'].includes(operation.status);
  return operations.sort((left, right) => {
    const activeDifference = Number(active(right.operation)) - Number(active(left.operation));
    return activeDifference || right.operation.updatedAt - left.operation.updatedAt;
  })[0];
}

function operationStatusLabel(operation: AccountManagerOperationView): string {
  if (operation.status === 'waiting_manual') return '等待人工';
  if (operation.status === 'interrupted') {
    return operation.errorCode === 'operation_terminated_by_user' ? '已终止' : '操作中断';
  }
  if (operation.status === 'failed') return '操作失败';
  if (operation.status === 'queued') return '排队中';
  return '执行中';
}

function operationIsActive(operation: AccountManagerOperationView): boolean {
  return ['queued', 'running', 'waiting_manual'].includes(operation.status);
}

function operationCanDismiss(operation: AccountManagerOperationView): boolean {
  return operation.status === 'failed' || operation.status === 'interrupted';
}

function operationControlRunning(operation: AccountManagerOperationView): boolean {
  return operation.control?.status === 'queued' || operation.control?.status === 'executing';
}

export function stopParentActionMenuPropagation(event: {
  domEvent: { stopPropagation: () => void };
}): void {
  event.domEvent.stopPropagation();
}

function canRotateOperationIp(operation: AccountManagerOperationView): boolean {
  if (!operationIsActive(operation) || operationControlRunning(operation)) return false;
  if (operation.status !== 'running') return true;
  return operation.phase !== 'payment_processing'
    && operation.phase !== 'workspace_onboarding_resuming'
    && !operation.phase.startsWith('workspace_')
    && !operation.phase.startsWith('team_workspace_upgrade_');
}

export function ParentList({
  groups,
  activeGroup,
  accounts,
  accountManagerStatuses,
  registrationTasks,
  maintainedAccountIds = new Set<string>(),
  searchQuery,
  quickFilters,
  selectedId,
  syncingIds,
  runtimeStatus,
  isBusy,
  onGroupChange,
  onSearchChange,
  onQuickFiltersChange,
  onOpenRegister,
  onOpenImport,
  onRetryRegistration,
  onRotateRegistrationIp,
  onRotateOperationIp,
  onTerminateOperation,
  onDismissOperation,
  onSelect,
  onRefreshAccount,
  onOpenDelete
}: {
  groups: Array<{ name: string; count: number }>;
  activeGroup: string;
  accounts: AccountSummaryView[];
  accountManagerStatuses: Record<string, ParentAccountManagerStatus>;
  registrationTasks: ParentRegistrationTaskView[];
  maintainedAccountIds?: Set<string>;
  searchQuery: string;
  quickFilters: ParentQuickFilter[];
  selectedId: string;
  syncingIds: Set<string>;
  runtimeStatus: AccountManagerRuntimeStatus | null;
  isBusy: (key: string) => boolean;
  onGroupChange: (group: string) => void;
  onSearchChange: (query: string) => void;
  onQuickFiltersChange: (filters: ParentQuickFilter[]) => void;
  onOpenRegister: () => void;
  onOpenImport: () => void;
  onRetryRegistration: (task: ParentRegistrationTaskView) => void;
  onRotateRegistrationIp: (task: ParentRegistrationTaskView) => void;
  onRotateOperationIp: (account: AccountSummaryView, operation: AccountManagerOperationView) => void;
  onTerminateOperation: (account: AccountSummaryView, operation: AccountManagerOperationView) => void;
  onDismissOperation: (account: AccountSummaryView, operation: AccountManagerOperationView) => void;
  onSelect: (account: AccountSummaryView) => void;
  onRefreshAccount: (account: AccountSummaryView) => void;
  onOpenDelete: (account: AccountSummaryView) => void;
}) {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const matchingTasks = quickFilters.length > 0 ? [] : registrationTasks.filter((task) =>
    !normalizedQuery || [task.email, task.registration.message, task.error]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery))
  );
  const records = [
    ...matchingTasks.map((task) => ({ kind: 'task' as const, id: task.registration.id, task })),
    ...accounts.map((account) => ({ kind: 'account' as const, id: account.id, account }))
  ];
  return (
    <div className="side-pane">
      <div className="side-actions">
        <Button
          type="primary"
          icon={<RobotOutlined />}
          loading={isBusy('register-parent')}
          disabled={runtimeStatus?.configured === false || runtimeStatus?.reachable === false}
          onClick={onOpenRegister}
        >
          自动注册
        </Button>
        <Button icon={<PlusOutlined />} onClick={onOpenImport}>
          录入母号
        </Button>
      </div>
      <KeywordSearchInput
        placeholder="搜索母号邮箱、备注、子号邮箱、子号备注"
        ariaLabel="搜索母号"
        value={searchQuery}
        onSearchChange={onSearchChange}
      />
      <ParentQuickFilterBar value={quickFilters} onChange={onQuickFiltersChange} />
      {groups.length > 0 && (
        <GroupSelector
          ariaLabel="筛选母号分组"
          value={activeGroup}
          options={[
            {
              label: `${ALL_PARENT_GROUP_LABEL} (${groups.reduce((sum, group) => sum + group.count, 0)})`,
              value: ALL_PARENT_GROUP
            },
            ...groups.map((group) => ({
              label: `${group.name} (${group.count})`,
              value: group.name
            }))
          ]}
          onChange={onGroupChange}
        />
      )}
      <List
        className="record-list"
        dataSource={records}
        rowKey={(record) => `${record.kind}:${record.id}`}
        locale={{
          emptyText: searchQuery || quickFilters.length > 0
            ? '没有匹配筛选条件的母号'
            : '当前分组没有母号'
        }}
        renderItem={(record) => {
          if (record.kind === 'task') {
            const task = record.task;
            const failed = task.stage === 'registration_failed' || task.stage === 'import_failed';
            const waiting = task.stage === 'waiting_manual';
            return (
              <List.Item>
                <Card size="small" className="record-card registration-job-card" aria-live="polite">
                  <div className="record-card-head">
                    <div className="record-title">
                      <Typography.Text strong ellipsis={{ tooltip: task.email || '自动注册母号' }}>
                        {task.email || '正在分配邮箱'}
                      </Typography.Text>
                      <Typography.Text type="secondary" ellipsis={{ tooltip: taskSummary(task) }}>
                        {taskSummary(task)}
                      </Typography.Text>
                    </div>
                    <Tag color={failed ? 'error' : waiting ? 'warning' : 'default'}>
                      {task.stage === 'waiting_manual'
                            ? '等待人工'
                            : failed
                              ? '操作失败'
                              : '注册中'}
                    </Tag>
                  </div>
                  <Progress
                    className="registration-job-progress"
                    percent={taskProgress(task)}
                    size="small"
                    status={failed ? 'exception' : 'active'}
                    format={(percent) => `${percent ?? 0}%`}
                  />
                  <Space wrap>
                    {waiting && (
                      <Button
                        size="small"
                        icon={<SwapOutlined />}
                        loading={isBusy(`rotate-parent-registration-ip-${task.registration.id}`)}
                        onClick={() => onRotateRegistrationIp(task)}
                      >
                        更换IP
                      </Button>
                    )}
                    {(task.stage === 'registration_failed' || task.stage === 'import_failed') && (
                      <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        loading={isBusy(`retry-parent-registration-${task.registration.id}`)}
                        onClick={() => onRetryRegistration(task)}
                      >
                        {task.stage === 'import_failed'
                            ? '重试导入'
                            : '重试注册'}
                      </Button>
                    )}
                  </Space>
                </Card>
              </List.Item>
            );
          }
          const account = record.account;
          const managerStatus = accountManagerStatuses[account.id];
          const hasTeamSubscription = managerStatus?.hasTeamSubscription || account.hasTeamSubscription;
          const canManageWorkspace = canManageParentWorkspace(account, managerStatus);
          const workspaceOperation = visibleWorkspaceOperation(managerStatus);
          const memberCount = parentMemberAndInviteCount(account);
          const seatCount = parentChatGptSeatUsageCount(account);
          const selected = account.id === selectedId;
          const syncing = syncingIds.has(account.id);
          const title = parentListIdentity(account);
          const workspaceLabel = account.workspaceName || account.accountId;
          const titleTooltip =
            workspaceLabel && workspaceLabel !== account.email ? `${title} · ${workspaceLabel}` : title;
          return (
            <List.Item>
              <Card
                className={selected ? 'record-card selected' : 'record-card'}
                size="small"
                hoverable
                onClick={() => onSelect(account)}
              >
                <div className="record-card-head">
                  <Typography.Text strong ellipsis={{ tooltip: titleTooltip }}>
                    {title}
                  </Typography.Text>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      onClick: stopParentActionMenuPropagation,
                      items: [
                        {
                          key: 'refresh',
                          icon: <ReloadOutlined />,
                          label: '同步 Workspace',
                          onClick: () => onRefreshAccount(account)
                        },
                        {
                          key: 'delete',
                          danger: true,
                          icon: <DeleteOutlined />,
                          label: '删除母号',
                          onClick: () => onOpenDelete(account)
                        }
                      ]
                    }}
                  >
                    <Button
                      aria-label="更多操作"
                      icon={<MoreOutlined />}
                      size="small"
                      type="text"
                      loading={syncing}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </Dropdown>
                </div>
                <div className="record-meta">
                  {account.canManageWorkspace ? (
                    <>
                      {account.hasTeamSubscription ? (
                        <span className={parentSeatUsageClass(seatCount, MAX_CHATGPT_SEATS)}>
                          ChatGPT {seatCount ?? '暂无'} / {MAX_CHATGPT_SEATS}
                        </span>
                      ) : (
                        <span>{account.planType === 'self_serve_business_usage_based' ? '0.52 Workspace' : 'Workspace'}</span>
                      )}
                      <span>成员/邀请 {memberCount ?? '暂无'}</span>
                    </>
                  ) : canManageWorkspace
                    ? <span>已发现 Workspace，等待同步</span>
                    : <span>尚无可管理 Workspace</span>}
                  {account.nextRenewalOn && <span>续费 {account.nextRenewalOn}</span>}
                </div>
                <div className="record-meta record-status-meta" aria-label="母号状态">
                  <BannedStatusTag isBanned={account.isBanned} />
                  {hasTeamSubscription && (
                    <span className="record-meta-tag"><LimitTypeTag limitType={account.limitType} /></span>
                  )}
                  <Tag color={account.managedAccountEmail ? 'blue' : 'default'}>
                    {account.managedAccountEmail ? 'GAM' : '非 GAM'}
                  </Tag>
                  <WorkspaceOpeningStatusTags
                    hasCodexSpace={hasParentCodexSpace(account, managerStatus)}
                    hasTeamSubscription={hasTeamSubscription}
                  />
                  {maintainedAccountIds.has(account.id) && <Tag color="processing">订单维护中</Tag>}
                  <span className="record-status-time">同步 {formatRelativeTime(account.lastRefreshAt)}</span>
                </div>
                {workspaceOperation && (
                  <div className="account-operation-progress" aria-live="polite">
                    <div className="account-operation-progress-head">
                      <Typography.Text strong>{workspaceOperation.label} 开通</Typography.Text>
                      <Space size={2}>
                        <Tag color={
                          workspaceOperation.operation.status === 'waiting_manual'
                            ? 'warning'
                            : workspaceOperation.operation.status === 'failed'
                              || workspaceOperation.operation.status === 'interrupted'
                              ? 'error'
                              : 'processing'
                        }>
                          {operationStatusLabel(workspaceOperation.operation)}
                        </Tag>
                        {operationCanDismiss(workspaceOperation.operation) && (
                          <Tooltip title="清除错误">
                            <Button
                              className="operation-dismiss-button"
                              type="text"
                              size="small"
                              shape="circle"
                              aria-label="清除开通错误"
                              icon={<CloseOutlined />}
                              loading={isBusy(`dismiss-operation-${workspaceOperation.operation.id}`)}
                              onClick={(event) => {
                                event.stopPropagation();
                                onDismissOperation(account, workspaceOperation.operation);
                              }}
                            />
                          </Tooltip>
                        )}
                      </Space>
                    </div>
                    <Typography.Text
                      className="account-operation-progress-message"
                      type={
                        workspaceOperation.operation.status === 'failed'
                          || workspaceOperation.operation.status === 'interrupted'
                          ? 'danger'
                          : 'secondary'
                      }
                      title={workspaceOperation.operation.errorMessage || workspaceOperation.operation.message}
                    >
                      {shortText(
                        workspaceOperation.operation.errorMessage
                          || workspaceOperation.operation.message
                          || workspaceOperation.operation.phase,
                        96
                      )}
                    </Typography.Text>
                    <Progress
                      percent={workspaceOperation.operation.progress}
                      size="small"
                      status={
                        workspaceOperation.operation.status === 'failed'
                          || workspaceOperation.operation.status === 'interrupted'
                          ? 'exception'
                          : workspaceOperation.operation.status === 'waiting_manual'
                            ? 'normal'
                            : 'active'
                      }
                      format={(percent) => `${percent ?? 0}%`}
                    />
                    {operationIsActive(workspaceOperation.operation) && (
                      <Space
                        size={6}
                        wrap
                        className="account-operation-actions"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Button
                          size="small"
                          icon={<SwapOutlined />}
                          disabled={!canRotateOperationIp(workspaceOperation.operation)}
                          loading={isBusy(`rotate-operation-ip-${workspaceOperation.operation.id}`)}
                          onClick={(event) => {
                            event.stopPropagation();
                            onRotateOperationIp(account, workspaceOperation.operation);
                          }}
                        >
                          更换IP
                        </Button>
                        <Popconfirm
                          title="终止当前开通任务？"
                          description="终止后会停止关联 profile，任务不会自动继续。"
                          okText="终止任务"
                          okButtonProps={{ danger: true }}
                          cancelText="取消"
                          onConfirm={() => onTerminateOperation(account, workspaceOperation.operation)}
                        >
                          <Button
                            danger
                            size="small"
                            icon={<StopOutlined />}
                            loading={isBusy(`terminate-operation-${workspaceOperation.operation.id}`)}
                            onClick={(event) => event.stopPropagation()}
                          >
                            终止任务
                          </Button>
                        </Popconfirm>
                      </Space>
                    )}
                  </div>
                )}
                {account.lastError && (
                  <Typography.Text className="record-error" type="danger" title={account.lastError}>
                    {shortText(account.lastError, 96)}
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

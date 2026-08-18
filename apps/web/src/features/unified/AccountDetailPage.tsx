import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { ProductModal, useProductMessage, useProductModal } from "../../components/ProductOverlays.js";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  AccountManagerOperationView,
  AccountManagerStateView,
  UnifiedAccountDetailView,
} from "@team-manager/shared";
import {
  unifiedApi,
  type AccountActivityView,
  type CredentialPoolGroupView,
  type PersonalSpaceDetailView,
} from "../../unifiedApi.js";
import {
  AccountActionButtons,
  AccountActionModals,
} from "./AccountActions.js";
import {
  actionModalFromParams,
  setAccountActionInParams,
  type AccountActionModal,
  type AccountActionSummary,
  lifecycleLabel,
  operationStatusLabel,
  primaryPlanLabel,
} from "./accountActionsModel.js";
import { LoadBoundary, PageHeader, formatTime } from "../../components/ProductPrimitives.js";
import { ActivityTimeline, BillingSummary, SubscriptionSummary } from "../../components/OperationalDataPanels.js";
import { AccountOperationSummary } from "./AccountOperationSummary.js";
import { OperationDrawer } from "../../components/OperationDrawer.js";
import { SubscriptionPaymentMethodModal } from "../../components/SubscriptionPaymentMethodModal.js";
import { errorMessage } from "../../api.js";
import { useUrlPagination } from "../../components/urlPagination.js";
import { AccountWorkspacePanel } from "./AccountWorkspacePanel.js";
import {
  resolvePersonalSpaceTab,
  selectPersonalSpaceTabParams,
  type PersonalSpaceTab,
} from "./accountPersonalModel.js";

export function AccountDetailPage() {
  const productModal = useProductModal();
  const productMessage = useProductMessage();
  const { accountId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [account, setAccount] = useState<UnifiedAccountDetailView>();
  const [manager, setManager] = useState<AccountManagerStateView>();
  const [personal, setPersonal] = useState<PersonalSpaceDetailView>();
  const [activity, setActivity] = useState<AccountActivityView[]>([]);
  const [poolGroups, setPoolGroups] = useState<CredentialPoolGroupView[]>([]);
  const [error, setError] = useState("");
  const [optionalErrors, setOptionalErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const load = async () => {
    if (!accountId) return;
    setLoading(true);
    setError("");
    try {
      const nextAccount = await unifiedApi.account(accountId);
      setAccount(nextAccount);
      const optional = await Promise.allSettled([
        nextAccount.gamAccountRef
          ? unifiedApi.accountManagerState(accountId)
          : Promise.resolve(undefined),
        unifiedApi.personalSpace(accountId),
        unifiedApi.accountActivity(accountId),
        unifiedApi.credentialPoolGroups(),
      ]);
      setOptionalErrors(optional.flatMap((result) => result.status === 'rejected' ? [(result.reason as Error).message] : []));
      if (optional[0].status === "fulfilled") setManager(optional[0].value);
      if (optional[1].status === "fulfilled") setPersonal(optional[1].value);
      if (optional[2].status === "fulfilled") setActivity(optional[2].value);
      if (optional[3].status === "fulfilled") setPoolGroups(optional[3].value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [accountId]);
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try {
      await action();
      productMessage.success("操作已完成");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const tab = params.get("tab") ?? "overview";
  const accountAction = actionModalFromParams(params);
  const selectedOperation = useMemo(
    () =>
      mergeOperations(
        account?.operations ?? [],
        manager?.operations ?? [],
      ).find((item) => item.id === params.get("operationId")),
    [account, manager, params],
  );
  const setUrl = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next);
  };
  const openAccountAction = (action: AccountActionModal) =>
    setParams(setAccountActionInParams(params, action, account?.id));
  const closeAccountAction = () =>
    setParams(setAccountActionInParams(params));
  const showCreatedOperation = (operation: AccountManagerOperationView) => {
    const next = setAccountActionInParams(params);
    next.set("operationId", operation.id);
    setParams(next);
  };
  return (
    <LoadBoundary
      loading={loading && !account}
      error={!account ? error : undefined}
      onRetry={load}
    >
      {account && (
        <Space direction="vertical" size={16} className="panel-stack">
          {error && (
            <Alert
              type="error"
              showIcon
              closable
              message={error}
              onClose={() => setError("")}
            />
          )}
          {optionalErrors.length > 0 && (
            <Alert type="warning" showIcon message="部分账号资料读取失败" description={optionalErrors.join('；')} />
          )}
          <Card>
            <PageHeader
              title={account.email}
              description={`账号 · ${account.group.name}`}
              actions={
                <>
                  <AccountActionButtons
                    account={account as AccountActionSummary}
                    profileStatus={manager?.profile?.status}
                    onOpen={openAccountAction}
                    onChanged={load}
                  />
                  <Button
                    danger
                    onClick={() =>
                      productModal.confirm({
                        title: "彻底删除账号？",
                        content: "账号、个人空间、Session、GAM 绑定及该账号的已完成操作历史会一起删除，独立的 Workspace 会保留。仍有活动 Workspace 关系、凭证、订单或未完成操作时将拒绝删除。",
                        okText: "彻底删除",
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          await unifiedApi.deleteAccount(account.id);
                          navigate("/accounts");
                        },
                      })
                    }
                  >
                    彻底删除账号
                  </Button>
                </>
              }
            />
          </Card>
          <Card>
            <Tabs
              activeKey={tab}
              onChange={(value) => setUrl("tab", value)}
              items={[
                {
                  key: "overview",
                  label: "概览",
                  children: <Overview account={account} manager={manager} openOperation={(id) => setUrl("operationId", id)} />,
                },
                {
                  key: "management",
                  label: "账号管理",
                  children: (
                    <Management
                      account={account}
                      manager={manager}
                      busy={busy}
                      run={run}
                    />
                  ),
                },
                {
                  key: "personal",
                  label: "个人空间",
                  children: (
                    <PersonalPanel
                      account={account}
                      personal={personal}
                      onPersonalChanged={setPersonal}
                    />
                  ),
                },
                {
                  key: "workspaces",
                  label: `Workspaces (${account.workspaces.length})`,
                  children: (
                    <AccountWorkspacePanel
                      account={account}
                      poolGroups={poolGroups}
                      onAccountChanged={load}
                    />
                  ),
                },
                {
                  key: "operations",
                  label: `操作记录 (${mergeOperations(account.operations, manager?.operations ?? []).length})`,
                  children: (
                    <Operations
                      operations={mergeOperations(
                        account.operations,
                        manager?.operations ?? [],
                      )}
                      open={(id) => setUrl("operationId", id)}
                    />
                  ),
                },
                {
                  key: "activity",
                  label: `活动日志 (${activity.length})`,
                  children: <ActivityTimeline value={activity}/>,
                },
              ]}
            />
          </Card>
          <AccountActionModals
            account={
              {
                ...account,
                profileStatus: manager?.profile?.status,
              } as AccountActionSummary
            }
            action={accountAction}
            onClose={closeAccountAction}
            onChanged={load}
            onOperationCreated={showCreatedOperation}
          />
          <OperationDrawer
            operation={selectedOperation}
            operationId={params.get("operationId") ?? undefined}
            open={Boolean(params.get("operationId"))}
            onClose={() => setUrl("operationId")}
            onChanged={load}
          />
        </Space>
      )}
    </LoadBoundary>
  );
}

function Overview({
  account,
  manager,
  openOperation,
}: {
  account: UnifiedAccountDetailView;
  manager?: AccountManagerStateView;
  openOperation: (id: string) => void;
}) {
  const invalidContexts = account.accessContexts.filter((item) => item.status === "invalid");
  return (
    <Space direction="vertical" size={16} className="panel-stack">
      {(account.isBanned || account.lastError || invalidContexts.length > 0) && <Alert type="error" showIcon message="账号需要处理" description={[
        account.isBanned ? "人工封号" : "",
        account.lastError,
        invalidContexts.length ? `${invalidContexts.length} 个登录上下文无效` : "",
      ].filter(Boolean).join("；")} />}
      {manager?.errors && <AccountManagerErrors errors={manager.errors} />}
      {account.latestOperation && <AccountOperationSummary operation={account.latestOperation} onOpen={openOperation} />}
      <Descriptions
        bordered
        column={{ xs: 1, sm: 2 }}
        items={[
        { key: "group", label: "分组", children: account.group.name },
        {
          key: "plan",
          label: "主套餐",
          children: <Space><Tag color="blue">{primaryPlanLabel(account.primaryPlan)}</Tag><Typography.Text type="secondary">{lifecycleLabel(account.primaryPlanLifecycle)}</Typography.Text></Space>,
        },
        {
          key: "gam",
          label: "GAM",
          children: account.gamAccountRef ?? "未关联",
        },
        {
          key: "profile",
          label: "Profile",
          children: manager?.profile?.status ?? "未知",
        },
        { key: "health", label: "登录健康", children: account.accessHealth.status === "invalid" ? <Tag color="error">无效</Tag> : account.accessHealth.status === "valid" ? <Tag color="success">有效</Tag> : "未验证" },
        { key: "remote-user-id", label: "ChatGPT User ID", children: account.remoteUserId ? <Typography.Text copyable>{account.remoteUserId}</Typography.Text> : "—" },
        { key: "remote-account-id", label: "Personal Account ID", children: account.personalSpace.remoteAccountId ? <Typography.Text copyable>{account.personalSpace.remoteAccountId}</Typography.Text> : "—" },
        { key: "limit", label: "限额类型", children: account.limitType },
        {
          key: "banned",
          label: "人工封号",
          children: account.isBanned ? <Tag color="red">是</Tag> : "否",
        },
        ]}
      />
      <Table pagination={false} rowKey={(row) => `${row.kind}:${row.workspaceName ?? "personal"}`} dataSource={account.accessContexts}
        columns={[
          { title: "登录上下文", render: (_, row) => row.kind === "personal" ? "个人空间" : row.workspaceName ?? "Workspace" },
          { title: "状态", dataIndex: "status", render: (value) => <Tag color={value === "invalid" ? "error" : value === "valid" ? "success" : "default"}>{value === "invalid" ? "无效" : value === "valid" ? "有效" : "未知"}</Tag> },
          { title: "检查时间", dataIndex: "checkedAt", render: (value) => value ? formatTime(value) : "—" },
          { title: "过期时间", dataIndex: "expiresAt", render: (value) => value ? formatTime(value) : "—" },
        ]} />
    </Space>
  );
}

function Management({
  account,
  manager,
  busy,
  run,
}: {
  account: UnifiedAccountDetailView;
  manager?: AccountManagerStateView;
  busy: string;
  run: (k: string, a: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <Space direction="vertical" size={16} className="panel-stack">
      {!account.gamAccountRef && (
        <Alert
          type="warning"
          showIcon
          message="账号尚未纳入 GAM 管理"
          description={account.hasSession ? "可以使用当前 Session 发起 existing_session 纳管。" : "请先通过“编辑”保存完整 Session。"}
          action={<Button type="primary" disabled={!account.hasSession} loading={busy === 'enroll'} onClick={() => run('enroll', () => unifiedApi.enrollAccountManager(account.id))}>纳入 GAM 管理</Button>}
        />
      )}
      {manager?.errors && <AccountManagerErrors errors={manager.errors} />}
      <Descriptions
        bordered
        column={{ xs: 1, sm: 2 }}
        items={[
          {
            key: "profile",
            label: "Profile",
            children: manager?.profile?.status ?? "未知",
          },
          {
            key: "profileId",
            label: "Profile ID",
            children: manager?.profile?.profileId ?? "—",
          },
          {
            key: "proxy",
            label: "住宅代理",
            children: manager?.proxy
              ? `${manager.proxy.country} / ${manager.proxy.sid}`
              : "未读取",
          },
          {
            key: "session",
            label: "本地 Session",
            children: account.hasSession ? "可用" : "无",
          },
        ]}
      />
    </Space>
  );
}

function PersonalPanel({
  account,
  personal,
  onPersonalChanged,
}: {
  account: UnifiedAccountDetailView;
  personal?: PersonalSpaceDetailView;
  onPersonalChanged: Dispatch<SetStateAction<PersonalSpaceDetailView | undefined>>;
}) {
  const productMessage = useProductMessage();
  const productModal = useProductModal();
  const [params, setParams] = useSearchParams();
  const [pendingActions, setPendingActions] = useState<Set<string>>(() => new Set());
  const pendingActionsRef = useRef(new Set<string>());
  const [error, setError] = useState('');
  const personalTab = resolvePersonalSpaceTab(params.get('personalTab'));
  const subscriptionSnapshot =
    personal?.subscription ?? account.personalSpace.subscription;
  const paidSubscription = Boolean(subscriptionSnapshot && !['free', 'unknown'].includes(subscriptionSnapshot.plan));
  const renewalCancelled = subscriptionSnapshot?.willRenew === false;
  const renewalEnd = subscriptionSnapshot?.endsAt ? formatTime(subscriptionSnapshot.endsAt) : '当前计费周期结束';

  const isPending = (key: string) => pendingActions.has(key);
  const setModal = (value?: string) => {
    const next = new URLSearchParams(params);
    value ? next.set('modal', value) : next.delete('modal');
    setParams(next);
  };
  const setPersonalTab = (value: string) => {
    setParams(selectPersonalSpaceTabParams(params, value as PersonalSpaceTab));
  };
  const runResource = async (
    resource: PersonalSpaceTab,
    key: string,
    successMessage: string,
    action: () => Promise<PersonalSpaceDetailView>,
  ) => {
    if (pendingActionsRef.current.has(key)) return false;
    pendingActionsRef.current = new Set(pendingActionsRef.current).add(key);
    setPendingActions(pendingActionsRef.current);
    setError('');
    try {
      const next = await action();
      onPersonalChanged((current) => ({ ...current, [resource]: next[resource] }));
      productMessage.success(successMessage);
      return true;
    } catch (reason) {
      const message = errorMessage(reason, "个人空间刷新失败");
      setError(message);
      productMessage.error(message);
      return false;
    } finally {
      const nextPendingActions = new Set(pendingActionsRef.current);
      nextPendingActions.delete(key);
      pendingActionsRef.current = nextPendingActions;
      setPendingActions(nextPendingActions);
    }
  };
  const refresh = (resource: PersonalSpaceTab, label: string) => runResource(
    resource,
    `refresh:${resource}`,
    `${label}已刷新`,
    () => unifiedApi.refreshPersonalSpace(account.id, resource),
  );

  return <Space direction="vertical" size={16} className="panel-stack">
    {error && <Alert type="error" showIcon closable message={error} onClose={() => setError('')} />}
    <Tabs
      activeKey={personalTab}
      onChange={setPersonalTab}
      items={[
        {
          key: 'subscription',
          label: '订阅',
          children: <PersonalSubscriptionPanel
            value={subscriptionSnapshot}
            refreshing={isPending('refresh:subscription')}
            cancelling={isPending('cancel:subscription')}
            paid={paidSubscription}
            renewalCancelled={renewalCancelled}
            onRefresh={() => void refresh('subscription', '订阅')}
            onCancel={() => productModal.confirm({
              title: '取消个人套餐自动续费？',
              content: `仅关闭自动续费，不退款；套餐权益保留到 ${renewalEnd}。`,
              okText: '确认取消续费',
              okButtonProps: { danger: true },
              cancelText: '返回',
              onOk: () => runResource('subscription', 'cancel:subscription', '自动续费已取消', () => unifiedApi.cancelPersonalRenewal(account.id)),
            })}
          />,
        },
        {
          key: 'billing',
          label: '账单与支付',
          children: <PersonalBillingPanel
            accountId={account.id}
            value={personal?.billing}
            billingRefreshing={isPending('refresh:billingDetails')}
            paymentMethodsRefreshing={isPending('refresh:paymentMethods')}
            onRefreshBilling={() => void runResource('billing', 'refresh:billingDetails', '账单已刷新', () => unifiedApi.refreshPersonalSpace(account.id, 'billingDetails'))}
            onRefreshPaymentMethods={() => void runResource('billing', 'refresh:paymentMethods', '支付方式已刷新', () => unifiedApi.refreshPersonalSpace(account.id, 'paymentMethods'))}
            onBind={() => setModal('payment')}
          />,
        },
        {
          key: 'quota',
          label: '额度',
          children: <PersonalQuotaPanel
            value={personal?.quota}
            refreshing={isPending('refresh:quota')}
            onRefresh={() => void refresh('quota', '额度')}
          />,
        },
        {
          key: 'settings',
          label: '设置',
          children: <PersonalSettingsPanel
            value={personal}
            refreshing={isPending('refresh:settings')}
            saving={isPending('save:settings')}
            onRefresh={() => void refresh('settings', '设置')}
            onSave={(value) => void runResource('settings', 'save:settings', '个人设置已保存', () => unifiedApi.updatePersonalSettings(account.id, value))}
          />,
        },
      ]}
    />
    <SubscriptionPaymentMethodModal
      targetLabel="个人空间"
      open={params.get('modal') === 'payment'}
      busy={isPending('bind:billing')}
      onClose={() => setModal()}
      loadDefaults={() => unifiedApi.paymentMethodDefaults(account.id)}
      onSubmit={async (value) => {
        const completed = await runResource('billing', 'bind:billing', '支付方式已绑定', async () => {
          await unifiedApi.addPersonalSpacePaymentMethod(account.id, value);
          return unifiedApi.personalSpace(account.id);
        });
        if (completed) setModal();
      }}
    />
  </Space>;
}

function PersonalSubscriptionPanel({ value, refreshing, cancelling, paid, renewalCancelled, onRefresh, onCancel }: {
  value?: PersonalSpaceDetailView['subscription'];
  refreshing: boolean;
  cancelling: boolean;
  paid: boolean;
  renewalCancelled: boolean;
  onRefresh: () => void;
  onCancel: () => void;
}) {
  return <Space direction="vertical" size={16} className="panel-stack">
    <Space wrap>
      <Typography.Text type="secondary">订阅快照：{formatTime(value?.observedAt)}</Typography.Text>
      <Button icon={<ReloadOutlined />} loading={refreshing} disabled={cancelling} onClick={onRefresh}>刷新订阅</Button>
      {paid && <Button danger={!renewalCancelled} disabled={renewalCancelled || refreshing} loading={cancelling} onClick={onCancel}>
        {renewalCancelled ? '已取消续费' : '取消续费'}
      </Button>}
    </Space>
    <SubscriptionSummary value={value} />
  </Space>;
}

function PersonalBillingPanel({ accountId, value, billingRefreshing, paymentMethodsRefreshing, onRefreshBilling, onRefreshPaymentMethods, onBind }: {
  accountId: string;
  value?: PersonalSpaceDetailView['billing'];
  billingRefreshing: boolean;
  paymentMethodsRefreshing: boolean;
  onRefreshBilling: () => void;
  onRefreshPaymentMethods: () => void;
  onBind: () => void;
}) {
  return <Space direction="vertical" size={16} className="panel-stack">
    <Space wrap>
      <Button icon={<ReloadOutlined />} loading={billingRefreshing} disabled={paymentMethodsRefreshing} onClick={onRefreshBilling}>刷新账单</Button>
      <Button icon={<ReloadOutlined />} loading={paymentMethodsRefreshing} disabled={billingRefreshing} onClick={onRefreshPaymentMethods}>刷新支付方式</Button>
      <Button type="primary" onClick={onBind}>绑定支付方式</Button>
    </Space>
    <BillingSummary value={value} paymentMethodActions={{
      onSetDefault: (paymentMethodId) => unifiedApi.setPersonalSpaceDefaultPaymentMethod(accountId, paymentMethodId),
      onRemove: (paymentMethodId) => unifiedApi.removePersonalSpacePaymentMethod(accountId, paymentMethodId),
    }}/>
  </Space>;
}

function PersonalQuotaPanel({ value, refreshing, onRefresh }: {
  value?: PersonalSpaceDetailView['quota'];
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const quotaPayload = asRecord(value?.payload);
  const quotaWindows = value?.windows ?? asRecordArray(quotaPayload?.windows) ?? asRecordArray(quotaPayload?.credits) ?? [];
  const quotaPagination = useUrlPagination({ total: quotaWindows.length, pageKey: 'quotaPage', pageSizeStorageKey: 'account-quota' });
  return <Space direction="vertical" size={16} className="panel-stack">
    <Space wrap>
      <Typography.Text type="secondary">额度快照：{formatTime(value?.observedAt)}</Typography.Text>
      <Button icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>刷新额度</Button>
    </Space>
    <Table
      rowKey={(row, index) => String(row.id ?? row.label ?? row.type ?? index)}
      dataSource={quotaWindows}
      pagination={quotaPagination}
      columns={[
        { title: '窗口/项目', render: (_, row) => String(row.label ?? row.name ?? row.type ?? row.id ?? '—') },
        { title: '使用率', render: (_, row) => row.usedPercent === undefined ? '—' : `${row.usedPercent}%` },
        { title: '数量', render: (_, row) => String(row.available_count ?? row.count ?? row.amount ?? '—') },
        { title: '重置时间', render: (_, row) => formatTime(asTime(row.resetAt ?? row.reset_at)) },
      ]}
    />
  </Space>;
}

function PersonalSettingsPanel({ value, refreshing, saving, onRefresh, onSave }: {
  value?: PersonalSpaceDetailView;
  refreshing: boolean;
  saving: boolean;
  onRefresh: () => void;
  onSave: (settings: Record<string, unknown>) => void;
}) {
  const settingsPayload = asRecord(value?.settings?.payload);
  const settingsValues = deriveSettingsValues(value, settingsPayload);
  return <Space direction="vertical" size={16} className="panel-stack">
    <Space wrap>
      <Typography.Text type="secondary">设置快照：{formatTime(value?.settings?.observedAt)}</Typography.Text>
      <Button icon={<ReloadOutlined />} loading={refreshing} disabled={saving} onClick={onRefresh}>刷新设置</Button>
    </Space>
    {Boolean(asRecord(settingsPayload?.profile)?.error) && <Alert type="warning" showIcon message="Profile 上游读取失败，请刷新设置后重试。" />}
    <Form key={value?.settings?.observedAt ?? 'settings-empty'} layout="vertical" initialValues={settingsValues} onFinish={onSave} disabled={refreshing}>
      <div className="responsive-form-grid">
        <Form.Item name="username" label="用户名"><Input /></Form.Item>
        <Form.Item name="displayName" label="显示名"><Input /></Form.Item>
      </div>
      <div className="switch-grid">
        <Form.Item name="marketingPush" label="营销推送" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="marketingEmail" label="营销邮件" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="memoryEnabled" label="Memory（三态）">
          <Select allowClear placeholder="未知（上游 GET 返回 405）" options={[
            { value: true, label: '明确开启' },
            { value: false, label: '明确关闭' },
          ]} />
        </Form.Item>
      </div>
      <Button htmlType="submit" loading={saving}>保存个人设置</Button>
    </Form>
  </Space>;
}

function Operations({
  operations,
  open,
}: {
  operations: AccountManagerOperationView[];
  open: (id: string) => void;
}) {
  const pagination=useUrlPagination({total:operations.length,pageKey:"operationsPage",pageSizeStorageKey:"account-operations"});
  return (
    <Table
      rowKey="id"
      dataSource={operations}
      pagination={pagination}
      scroll={{ x: 1000 }}
      columns={[
        { title: "时间", dataIndex: "updatedAt", render: formatTime },
        { title: "类型", dataIndex: "type", render: operationTypeLabel },
        { title: "状态", dataIndex: "status", render: (v) => <Tag>{operationStatusLabel(v)}</Tag> },
        { title: "阶段", dataIndex: "phase", render: readableCode },
        { title: "进度", dataIndex: "progress", render: (v) => `${v ?? 0}%` },
        { title: "错误", dataIndex: "errorMessage" },
        {
          title: "操作",
          fixed: "right",
          render: (_, row) => (
            <Button size="small" onClick={() => open(row.id)}>
              查看与恢复
            </Button>
          ),
        },
      ]}
    />
  );
}

function readableCode(value: unknown): string {
  return String(value ?? "—").replaceAll("_", " ");
}

function operationTypeLabel(value: string): string {
  return ({ register_account: "注册账号", change_personal_subscription: "个人套餐", cancel_personal_subscription_renewal: "取消续费", open_business_subscription: "Business 套餐" } as Record<string, string>)[value] ?? readableCode(value);
}

function AccountManagerErrors({ errors }: { errors: NonNullable<AccountManagerStateView['errors']> }) {
  const labels = { service: 'GAM 服务', profile: 'Profile', proxy: '住宅代理', operations: '操作记录' };
  const values = Object.entries(errors).map(([key, value]) => `${labels[key as keyof typeof labels]}：${value}`);
  return values.length ? <Alert type="warning" showIcon message="GAM 部分资源读取失败" description={values.join('；')} /> : null;
}
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function asRecordArray(value: unknown): Record<string, unknown>[] | undefined {
  return Array.isArray(value)
    ? (value.map(asRecord).filter(Boolean) as Record<string, unknown>[])
    : undefined;
}
function asTime(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number"
    ? value
    : undefined;
}
function deriveSettingsValues(
  personal: PersonalSpaceDetailView | undefined,
  payload: Record<string, unknown> | undefined,
) {
  const explicit =
    personal?.settings?.values ?? asRecord(payload?.values) ?? {};
  const profile = personal?.settings?.profile ?? asRecord(payload?.profile);
  const validProfile = profile && !profile.error ? profile : undefined;
  const me = asRecord(payload?.me);
  const notifications = asRecord(payload?.notifications);
  const marketing = notificationCategory(notifications, "marketing");
  return {
    ...explicit,
    username: explicit.username ?? validProfile?.username,
    displayName: explicit.displayName ?? validProfile?.display_name ?? me?.name,
    marketingPush:
      explicit.marketingPush ?? notificationChannel(marketing, "push"),
    marketingEmail:
      explicit.marketingEmail ?? notificationChannel(marketing, "email"),
    memoryEnabled:
      typeof explicit.memoryEnabled === "boolean"
        ? explicit.memoryEnabled
        : undefined,
  };
}
function notificationCategory(
  value: Record<string, unknown> | undefined,
  category: string,
) {
  const settings = asRecordArray(value?.settings) ?? [];
  return settings.find((item) => item.category === category);
}
function notificationChannel(
  value: Record<string, unknown> | undefined,
  channel: string,
) {
  const options = asRecordArray(value?.options) ?? [];
  const option = options.find((item) => item.channel === channel);
  return typeof option?.enabled === "boolean" ? option.enabled : undefined;
}
function mergeOperations<T extends { id: string; updatedAt: number }>(
  local: T[],
  remote: T[],
): T[] {
  const values = new Map(remote.map((item) => [item.id, item]));
  for (const item of local) if (!values.has(item.id)) values.set(item.id, item);
  return [...values.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

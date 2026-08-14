import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
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
import { PaymentCardFields } from "../../components/PaymentCardFields.js";
import { useUrlPagination } from "../../components/urlPagination.js";
import { AccountWorkspacePanel } from "./AccountWorkspacePanel.js";

export function AccountDetailPage() {
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
      message.success("操作已完成");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const tab = params.get("tab") ?? "overview";
  const modal = params.get("modal");
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
                      Modal.confirm({
                        title: "删除账号？",
                        content: "有关联关系或历史时数据库会拒绝删除。",
                        onOk: async () => {
                          await unifiedApi.deleteAccount(account.id);
                          navigate("/accounts");
                        },
                      })
                    }
                  >
                    删除账号
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
                      busy={busy}
                      run={run}
                      open={(name) => setUrl("modal", name)}
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
          <PaymentModal
            accountId={account.id}
            open={modal === "payment"}
            busy={busy === "payment"}
            onClose={() => setUrl("modal")}
            onSubmit={(value) =>
              run("payment", async () => {
                await unifiedApi.addPaymentMethod(account.id, value);
                setUrl("modal");
              })
            }
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
        { key: "sync", label: "最近 GAM 同步", children: account.lastSyncedAt ? formatTime(account.lastSyncedAt) : "未同步" },
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
      <Space wrap>
        <Button
          disabled={!account.gamAccountRef}
          loading={busy === "sync"}
          onClick={() =>
            run("sync", () => unifiedApi.syncAccountManager(account.id))
          }
        >
          同步 GAM 与 Workspace
        </Button>
      </Space>
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
  busy,
  run,
  open,
}: {
  account: UnifiedAccountDetailView;
  personal?: PersonalSpaceDetailView;
  busy: string;
  run: (key: string, action: () => Promise<unknown>) => Promise<void>;
  open: (value: string) => void;
}) {
  const subscriptionSnapshot =
    personal?.subscription ?? account.personalSpace.subscription;
  const billing = personal?.billing;
  const settingsPayload = asRecord(personal?.settings?.payload);
  const settingsValues = deriveSettingsValues(personal, settingsPayload);
  const quotaPayload = asRecord(personal?.quota?.payload);
  const quotaWindows =
    personal?.quota?.windows ??
    asRecordArray(quotaPayload?.windows) ??
    asRecordArray(quotaPayload?.credits) ??
    [];
  const quotaPagination=useUrlPagination({total:quotaWindows.length,pageKey:"quotaPage",pageSizeStorageKey:"account-quota"});
  const paidSubscription = Boolean(subscriptionSnapshot && !['free', 'unknown'].includes(subscriptionSnapshot.plan));
  const renewalCancelled = subscriptionSnapshot?.willRenew === false;
  const renewalEnd = subscriptionSnapshot?.endsAt ? formatTime(subscriptionSnapshot.endsAt) : '当前计费周期结束';

  return (
    <Space direction="vertical" size={18} className="panel-stack">
      <Space wrap>
        <Button
          icon={<ReloadOutlined />}
          loading={busy === "personal"}
          onClick={() =>
            run("personal", () => unifiedApi.refreshPersonalSpace(account.id))
          }
        >
          刷新个人空间
        </Button>
        {paidSubscription && <Button
          danger={!renewalCancelled}
          disabled={renewalCancelled}
          loading={busy === 'cancel'}
          onClick={() => Modal.confirm({
            title: '取消个人套餐自动续费？',
            content: `仅关闭自动续费，不退款；套餐权益保留到 ${renewalEnd}。`,
            okText: '确认取消续费',
            okButtonProps: { danger: true },
            cancelText: '返回',
            onOk: () => run('cancel', () => unifiedApi.cancelPersonalRenewal(account.id)),
          })}
        >
          {renewalCancelled ? '已取消续费' : '取消续费'}
        </Button>}
        <Button onClick={() => open("payment")}>绑定支付方式</Button>
      </Space>

      <Typography.Title level={4}>订阅</Typography.Title>
      <SubscriptionSummary value={subscriptionSnapshot} />

      <Typography.Title level={4}>账单与支付</Typography.Title>
      <BillingSummary value={billing}/>

      <Typography.Title level={4}>额度窗口与额度项目</Typography.Title>
      <Table
        rowKey={(row, index) =>
          String(row.id ?? row.label ?? row.type ?? index)
        }
        dataSource={quotaWindows}
        pagination={quotaPagination}
        columns={[
          {
            title: "窗口/项目",
            render: (_, row) =>
              String(row.label ?? row.name ?? row.type ?? row.id ?? "—"),
          },
          {
            title: "使用率",
            render: (_, row) =>
              row.usedPercent === undefined ? "—" : `${row.usedPercent}%`,
          },
          {
            title: "数量",
            render: (_, row) =>
              String(row.available_count ?? row.count ?? row.amount ?? "—"),
          },
          {
            title: "重置时间",
            render: (_, row) => formatTime(asTime(row.resetAt ?? row.reset_at)),
          },
        ]}
      />

      <Typography.Title level={4}>资料与设置</Typography.Title>
      {Boolean(asRecord(settingsPayload?.profile)?.error) && (
        <Alert
          type="warning"
          showIcon
          message="Profile 上游读取失败，请刷新个人空间后重试。"
        />
      )}
      <Form
        key={personal?.settings?.observedAt ?? "settings-empty"}
        layout="vertical"
        initialValues={settingsValues}
        onFinish={(value) =>
          run("personal-settings", () =>
            unifiedApi.updatePersonalSettings(account.id, value),
          )
        }
      >
        <div className="responsive-form-grid">
          <Form.Item name="username" label="用户名">
            <Input />
          </Form.Item>
          <Form.Item name="displayName" label="显示名">
            <Input />
          </Form.Item>
        </div>
        <div className="switch-grid">
          <Form.Item
            name="marketingPush"
            label="营销推送"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="marketingEmail"
            label="营销邮件"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="memoryEnabled" label="Memory（三态）">
            <Select
              allowClear
              placeholder="未知（上游 GET 返回 405）"
              options={[
                { value: true, label: "明确开启" },
                { value: false, label: "明确关闭" },
              ]}
            />
          </Form.Item>
        </div>
        <Button htmlType="submit" loading={busy === "personal-settings"}>
          保存个人设置
        </Button>
      </Form>
    </Space>
  );
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
  return ({ register_account: "注册账号", change_personal_subscription: "个人套餐", cancel_personal_subscription_renewal: "取消续费", open_business_subscription: "Business 套餐", add_personal_payment_method: "绑定支付方式" } as Record<string, string>)[value] ?? readableCode(value);
}

function PaymentModal({
  accountId,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  accountId: string;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (value: any) => Promise<void>;
}) {
  const [form] = Form.useForm();
  const [defaultsLoading, setDefaultsLoading] = useState(false);
  const [defaultsError, setDefaultsError] = useState('');
  useEffect(() => {
    if (!open) return;
    setDefaultsLoading(true);
    setDefaultsError('');
    void unifiedApi.personalPaymentMethodDefaults(accountId)
      .then((value) => form.setFieldsValue(value))
      .catch((reason) => setDefaultsError((reason as Error).message))
      .finally(() => setDefaultsLoading(false));
  }, [accountId, form, open]);
  return (
    <Modal
      title="绑定个人支付方式"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        message="完整卡号和 CVC 只在本次请求中转交 GAM。"
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{ country: "US", currency: "USD" }}
        onFinish={(v) =>
          onSubmit({
            country: v.country.toUpperCase(),
            currency: v.currency.toUpperCase(),
            card: v.card,
          })
        }
      >
        <div className="responsive-form-grid">
          <Form.Item name="country" label="国家" rules={[{ required: true }]}>
            <Input maxLength={2} />
          </Form.Item>
          <Form.Item name="currency" label="货币" rules={[{ required: true }]}>
            <Input maxLength={3} />
          </Form.Item>
        </div>
        <PaymentCardFields prefix="card" quickInput />
        {defaultsError && <Alert className="modal-error" type="warning" showIcon message={`GAM 默认账单资料读取失败：${defaultsError}`} />}
        <Button type="primary" htmlType="submit" loading={busy || defaultsLoading}>
          提交给 GAM
        </Button>
      </Form>
    </Modal>
  );
}

function AccountManagerErrors({ errors }: { errors: NonNullable<AccountManagerStateView['errors']> }) {
  const labels = { service: 'GAM 服务', account: '账号资料', profile: 'Profile', proxy: '住宅代理', operations: '操作记录' };
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

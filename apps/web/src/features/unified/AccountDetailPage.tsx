import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
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
import {
  DownloadOutlined,
  EyeOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  AccountGroupView,
  AccountManagerOperationView,
  AccountManagerStateView,
  UnifiedAccountDetailView,
  WorkspaceCredentialView,
} from "@team-manager/shared";
import {
  unifiedApi,
  type AccountActivityView,
  type CredentialPoolGroupView,
  type PersonalSpaceDetailView,
} from "../../unifiedApi.js";
import { SubscriptionModal } from "./SubscriptionModal.js";
import {
  JsonViewer,
  LoadBoundary,
  PageHeader,
  formatTime,
} from "../../components/ProductPrimitives.js";
import { OperationDrawer } from "../../components/OperationDrawer.js";
import { PaymentCardFields } from "../../components/PaymentCardFields.js";
import { parseCredentialReplacement } from "./unifiedUiModels.js";
import { useRememberedForm } from "../../webPreferences.js";

export function AccountDetailPage() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [account, setAccount] = useState<UnifiedAccountDetailView>();
  const [manager, setManager] = useState<AccountManagerStateView>();
  const [groups, setGroups] = useState<AccountGroupView[]>([]);
  const [personal, setPersonal] = useState<PersonalSpaceDetailView>();
  const [activity, setActivity] = useState<AccountActivityView[]>([]);
  const [poolGroups, setPoolGroups] = useState<CredentialPoolGroupView[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const load = async () => {
    if (!accountId) return;
    setLoading(true);
    setError("");
    try {
      const [nextAccount, nextGroups] = await Promise.all([
        unifiedApi.account(accountId),
        unifiedApi.groups(),
      ]);
      setAccount(nextAccount);
      setGroups(nextGroups);
      const optional = await Promise.allSettled([
        nextAccount.gamAccountRef
          ? unifiedApi.accountManagerState(accountId)
          : Promise.resolve(undefined),
        unifiedApi.personalSpace(accountId),
        unifiedApi.accountActivity(accountId),
        unifiedApi.credentialPoolGroups(),
      ]);
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
          <Card>
            <PageHeader
              title={account.email}
              description={`账号 · ${account.group.name}`}
              actions={
                <>
                  <Button onClick={() => setUrl("modal", "subscription")}>
                    套餐操作
                  </Button>
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
                  children: <Overview account={account} manager={manager} />,
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
                  key: "settings",
                  label: "账号设置",
                  children: (
                    <AccountSettings
                      account={account}
                      groups={groups}
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
                    <Table
                      rowKey="id"
                      dataSource={account.workspaces}
                      scroll={{ x: 850 }}
                      onRow={(row) => ({
                        onClick: () =>
                          navigate(
                            `/accounts/${account.id}/workspaces/${row.id}`,
                          ),
                        style: { cursor: "pointer" },
                      })}
                      columns={[
                        {
                          title: "名称",
                          render: (_, row) => row.name ?? row.externalId,
                        },
                        { title: "角色", dataIndex: "role" },
                        { title: "席位", dataIndex: "seatType" },
                        { title: "状态", dataIndex: "membershipStatus" },
                        {
                          title: "管理",
                          dataIndex: "manageable",
                          render: (value) =>
                            value ? <Tag color="green">可管理</Tag> : "—",
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: "credentials",
                  label: `凭证 (${account.credentials.length})`,
                  children: (
                    <CredentialsPanel
                      account={account}
                      poolGroups={poolGroups}
                      busy={busy}
                      run={run}
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
                  children: (
                    <Table
                      rowKey="id"
                      dataSource={activity}
                      scroll={{ x: 900 }}
                      columns={[
                        {
                          title: "时间",
                          dataIndex: "occurredAt",
                          render: formatTime,
                        },
                        { title: "类型", dataIndex: "kind" },
                        {
                          title: "原始载荷",
                          dataIndex: "payload",
                          render: (value) => (
                            <JsonViewer title="查看" value={value} />
                          ),
                        },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </Card>
          <SubscriptionModal
            accountId={account.id}
            currentPlan={account.personalPlan}
            open={modal === "subscription"}
            onClose={() => {
              setUrl("modal");
              void load();
            }}
          />
          <PaymentModal
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
}: {
  account: UnifiedAccountDetailView;
  manager?: AccountManagerStateView;
}) {
  return (
    <Descriptions
      bordered
      column={{ xs: 1, sm: 2 }}
      items={[
        { key: "group", label: "分组", children: account.group.name },
        {
          key: "plan",
          label: "个人套餐",
          children: <Tag color="blue">{account.personalPlan}</Tag>,
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
        {
          key: "session",
          label: "Session",
          children: account.hasSession ? "已保存" : "无",
        },
        {
          key: "cap",
          label: "可管理空间",
          children: account.hasManageableWorkspace ? "是" : "否",
        },
        {
          key: "member",
          label: "普通成员",
          children: account.isWorkspaceMember ? "是" : "否",
        },
        { key: "credential", label: "凭证", children: account.credentialCount },
        { key: "limit", label: "限额类型", children: account.limitType },
        {
          key: "banned",
          label: "人工封号",
          children: account.isBanned ? <Tag color="red">是</Tag> : "否",
        },
      ]}
    />
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
        <Alert type="warning" showIcon message="请先绑定 GAM 账号引用" />
      )}
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
        <Button
          disabled={!account.gamAccountRef}
          loading={busy === "start"}
          onClick={() =>
            run("start", () => unifiedApi.startProfile(account.id))
          }
        >
          启动 Profile
        </Button>
        <Button
          disabled={!account.gamAccountRef}
          loading={busy === "stop"}
          onClick={() => run("stop", () => unifiedApi.stopProfile(account.id))}
        >
          停止 Profile
        </Button>
        <Button
          disabled={!account.gamAccountRef}
          loading={busy === "session"}
          onClick={() =>
            run("session", () => unifiedApi.importGamSession(account.id))
          }
        >
          从 GAM 更新 Session
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
      <Form
        layout="vertical"
        initialValues={manager?.proxy}
        onFinish={(value) =>
          run("proxy", () =>
            unifiedApi.configureProxy(account.id, {
              sid: value.sid,
              country: value.country,
              asn: value.asn || null,
              state: value.state || null,
              city: value.city || null,
            }),
          )
        }
      >
        <div className="responsive-form-grid">
          <Form.Item name="sid" label="代理 SID" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="country" label="国家" rules={[{ required: true }]}>
            <Input maxLength={2} />
          </Form.Item>
          <Form.Item name="asn" label="ASN">
            <Input />
          </Form.Item>
          <Form.Item name="state" label="州/省">
            <Input />
          </Form.Item>
          <Form.Item name="city" label="城市">
            <Input />
          </Form.Item>
        </div>
        <Button
          htmlType="submit"
          loading={busy === "proxy"}
          disabled={!account.gamAccountRef}
        >
          保存 GAM 代理
        </Button>
      </Form>
    </Space>
  );
}

function AccountSettings({
  account,
  groups,
  busy,
  run,
}: {
  account: UnifiedAccountDetailView;
  groups: AccountGroupView[];
  busy: string;
  run: (k: string, a: () => Promise<unknown>) => Promise<void>;
}) {
  const [session, setSession] = useState("");
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const loadSession = async () => {
    const value = await unifiedApi.accountSession(account.id);
    setSession(JSON.stringify(value, null, 2));
    setSessionLoaded(true);
  };
  return (
    <Space direction="vertical" size={20} className="panel-stack">
      <Form
        layout="vertical"
        initialValues={{
          groupId: account.group.id,
          remark: account.remark,
          displayName: account.displayName,
          gamAccountRef: account.gamAccountRef,
          isBanned: account.isBanned,
          limitType: account.limitType,
        }}
        onFinish={(value) =>
          run("settings", () => unifiedApi.updateAccount(account.id, value))
        }
      >
        <div className="responsive-form-grid">
          <Form.Item name="groupId" label="分组">
            <Select
              options={groups.map((group) => ({
                value: group.id,
                label: group.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="displayName" label="显示名">
            <Input />
          </Form.Item>
          <Form.Item name="gamAccountRef" label="GAM 账号引用">
            <Input allowClear />
          </Form.Item>
          <Form.Item name="limitType" label="限额类型">
            <Select
              options={[
                { value: "unknown", label: "未知" },
                { value: "weekly", label: "周限" },
                { value: "monthly", label: "月限" },
              ]}
            />
          </Form.Item>
        </div>
        <Form.Item name="remark" label="备注">
          <Input.TextArea />
        </Form.Item>
        <Form.Item name="isBanned" label="人工封号" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Button htmlType="submit" type="primary" loading={busy === "settings"}>
          保存账号资料
        </Button>
      </Form>
      <section>
        <Typography.Title level={4}>完整 ChatGPT Session</Typography.Title>
        <Space direction="vertical" className="panel-stack">
          <Alert
            type="info"
            showIcon
            message="这是管理员调试入口，读取和保存完整 Session，不做脱敏。"
          />
          {!sessionLoaded ? (
            <Button onClick={() => void loadSession()}>读取完整 Session</Button>
          ) : (
            <>
              <Input.TextArea
                value={session}
                onChange={(e) => setSession(e.target.value)}
                autoSize={{ minRows: 10, maxRows: 30 }}
                className="raw-json"
              />
              <Button
                type="primary"
                onClick={() =>
                  run("save-session", () =>
                    unifiedApi.updateAccountSession(
                      account.id,
                      JSON.parse(session),
                    ),
                  )
                }
              >
                保存完整 Session
              </Button>
            </>
          )}
        </Space>
      </section>
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
  const subscription = snapshotPayload(subscriptionSnapshot);
  const billing = personal?.billing;
  const settingsPayload = asRecord(personal?.settings?.payload);
  const settingsValues = deriveSettingsValues(personal, settingsPayload);
  const quotaPayload = asRecord(personal?.quota?.payload);
  const quotaWindows =
    personal?.quota?.windows ??
    asRecordArray(quotaPayload?.windows) ??
    asRecordArray(quotaPayload?.credits) ??
    [];
  const paymentMethods = billing?.paymentMethods?.length
    ? billing.paymentMethods
    : account.paymentMethods;

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
        <Button type="primary" onClick={() => open("subscription")}>
          开通或变更套餐
        </Button>
        <Button
          onClick={() =>
            run("cancel", () => unifiedApi.cancelPersonalRenewal(account.id))
          }
        >
          取消续费
        </Button>
        <Button onClick={() => open("payment")}>绑定支付方式</Button>
      </Space>

      <Typography.Title level={4}>订阅</Typography.Title>
      <StructuredObject value={subscription} />
      <JsonViewer title="个人订阅原始 JSON" value={subscriptionSnapshot} />

      <Typography.Title level={4}>账单与支付</Typography.Title>
      <StructuredObject value={billing?.summary} />
      <Table
        rowKey={(row) => String(row.id ?? row.externalId ?? row.number)}
        dataSource={billing?.invoices ?? []}
        scroll={{ x: 700 }}
        columns={[
          {
            title: "发票",
            render: (_, row) =>
              row.number ??
              row.externalId ??
              String(row.payload.number ?? row.id),
          },
          { title: "金额", dataIndex: "amount" },
          { title: "状态", dataIndex: "status" },
          {
            title: "时间",
            render: (_, row) => formatTime(row.occurredAt ?? row.createdAt),
          },
          {
            title: "原文",
            render: (_, row) => (
              <JsonViewer title="发票原文" value={row.payload} />
            ),
          },
        ]}
      />
      <Table
        rowKey="id"
        pagination={false}
        dataSource={paymentMethods}
        scroll={{ x: 600 }}
        columns={[
          { title: "品牌", dataIndex: "brand" },
          { title: "尾号", dataIndex: "last4" },
          {
            title: "到期",
            render: (_, row) =>
              row.expMonth && row.expYear
                ? `${row.expMonth}/${row.expYear}`
                : "—",
          },
          {
            title: "默认",
            dataIndex: "isDefault",
            render: (value) => (value ? <Tag color="green">是</Tag> : "否"),
          },
        ]}
      />
      <JsonViewer
        title="个人账单原始 JSON"
        value={billing?.raw ?? billing?.payload ?? billing}
      />

      <Typography.Title level={4}>额度窗口与额度项目</Typography.Title>
      <Table
        rowKey={(row, index) =>
          String(row.id ?? row.label ?? row.type ?? index)
        }
        dataSource={quotaWindows}
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
      <JsonViewer
        title="个人额度原始 JSON"
        value={personal?.quota?.raw ?? quotaPayload ?? personal?.quota}
      />

      <Typography.Title level={4}>资料与设置</Typography.Title>
      {Boolean(asRecord(settingsPayload?.profile)?.error) && (
        <Alert
          type="warning"
          showIcon
          message="Profile 上游读取失败，详情保留在下方完整 JSON 中。"
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
      <JsonViewer
        title="个人设置原始 JSON"
        value={personal?.settings?.raw ?? settingsPayload ?? personal?.settings}
      />
    </Space>
  );
}

function CredentialsPanel({
  account,
  poolGroups,
  busy,
  run,
}: {
  account: UnifiedAccountDetailView;
  poolGroups: CredentialPoolGroupView[];
  busy: string;
  run: (k: string, a: () => Promise<unknown>) => Promise<void>;
}) {
  const [credentialForm] = Form.useForm();
  const rememberCredentialForm = useRememberedForm(
    credentialForm,
    "create-workspace-credential",
    ["workspaceId", "kind", "poolGroup", "name"],
  );
  const [view, setView] = useState<{
    credential: WorkspaceCredentialView;
    content: unknown;
  }>();
  const [viewError, setViewError] = useState("");
  const [oauth, setOauth] = useState<{
    sessionId: string;
    authUrl: string;
    poolGroup?: string;
  }>();
  const [oauthCallback, setOauthCallback] = useState("");
  const [replacement, setReplacement] = useState<{
    credential: WorkspaceCredentialView;
    json: string;
  }>();
  const create = async (
    kind: "pat" | "oauth",
    value: Record<string, string>,
  ) => {
    rememberCredentialForm(value);
    if (kind === "pat")
      return run(kind, () =>
        unifiedApi.createPatCredential(account.id, value.workspaceId, {
          name: value.name,
          poolGroupId: value.poolGroup,
        }),
      );
    try {
      setOauthCallback("");
      const auth = await unifiedApi.createOauthCredential(
        account.id,
        value.workspaceId,
      );
      setOauth({ ...auth, poolGroup: value.poolGroup });
      window.open(auth.authUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      setViewError((e as Error).message);
    }
  };
  const show = async (row: WorkspaceCredentialView) => {
    setViewError("");
    try {
      setView({
        credential: row,
        content: await unifiedApi.credentialContent(row.id),
      });
    } catch (e) {
      setViewError((e as Error).message);
    }
  };
  return (
    <Space direction="vertical" className="panel-stack">
      {viewError && <Alert type="error" showIcon message={viewError} />}
      <Form
        form={credentialForm}
        layout="inline"
        onFinish={(v) => create(v.kind, v)}
        initialValues={{ kind: "pat" }}
      >
        <Form.Item
          name="workspaceId"
          label="Workspace"
          rules={[{ required: true }]}
        >
          <Select
            style={{ width: 250 }}
            options={account.workspaces.map((w) => ({
              value: w.id,
              label: w.name ?? w.externalId,
            }))}
          />
        </Form.Item>
        <Form.Item name="kind" label="类型">
          <Select
            style={{ width: 110 }}
            options={[
              { value: "pat", label: "PAT" },
              { value: "oauth", label: "OAuth" },
            ]}
          />
        </Form.Item>
        <Form.Item name="poolGroup" label="号池组">
          <Select
            allowClear
            style={{ width: 180 }}
            options={poolGroups.map((g) => ({ value: g.id, label: g.name }))}
          />
        </Form.Item>
        <Form.Item name="name" label="名称">
          <Input />
        </Form.Item>
        <Button
          htmlType="submit"
          type="primary"
          loading={busy === "pat" || busy === "oauth"}
        >
          创建凭证
        </Button>
      </Form>
      <Table<WorkspaceCredentialView>
        rowKey="id"
        dataSource={account.credentials}
        scroll={{ x: 1050 }}
        columns={[
          { title: "Workspace", dataIndex: "workspaceId" },
          { title: "类型", dataIndex: "kind" },
          { title: "号池组", render: (_, row) => row.poolGroup?.name ?? "—" },
          { title: "状态", dataIndex: "status" },
          {
            title: "额度",
            render: (_, row) =>
              row.latestQuota
                ? `${row.latestQuota.status} · ${row.latestQuota.windows.map((w) => `${w.label} ${w.usedPercent ?? "?"}%`).join(" / ")}`
                : "未刷新",
          },
          {
            title: "操作",
            fixed: "right",
            render: (_, row) => (
              <Space>
                <Button
                  size="small"
                  onClick={() =>
                    run(`quota-${row.id}`, () =>
                      unifiedApi.refreshCredentialQuota(row.id),
                    )
                  }
                >
                  刷新额度
                </Button>
                <Button
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => void show(row)}
                >
                  完整 JSON
                </Button>
                <Button
                  size="small"
                  onClick={async () => {
                    setViewError("");
                    try {
                      const content = await unifiedApi.credentialContent(
                        row.id,
                      );
                      setReplacement({
                        credential: row,
                        json: JSON.stringify(content, null, 2),
                      });
                    } catch (e) {
                      setViewError((e as Error).message);
                    }
                  }}
                >
                  替换 JSON
                </Button>
                {row.kind === "oauth" && (
                  <Button
                    size="small"
                    onClick={() =>
                      void create("oauth", {
                        workspaceId: row.workspaceId,
                        poolGroup: row.poolGroup?.id ?? "",
                      })
                    }
                  >
                    OAuth 重新授权
                  </Button>
                )}
                <Button
                  size="small"
                  onClick={() =>
                    run(`disable-${row.id}`, () =>
                      unifiedApi.updateCredential(row.id, {
                        status:
                          row.status === "disabled" ? "active" : "disabled",
                      }),
                    )
                  }
                >
                  {row.status === "disabled" ? "启用" : "停用"}
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    Modal.confirm({
                      title: "投放凭证到号池",
                      content: (
                        <>
                          <Input
                            id={`target-${row.id}`}
                            placeholder="目标键，默认 default"
                          />
                          <Input
                            id={`filename-${row.id}`}
                            placeholder="文件名（可选）"
                          />
                        </>
                      ),
                      onOk: () =>
                        run(`deploy-${row.id}`, () =>
                          unifiedApi.deployCredential(row.id, {
                            targetKey:
                              (
                                document.getElementById(
                                  `target-${row.id}`,
                                ) as HTMLInputElement
                              ).value || "default",
                            fileName:
                              (
                                document.getElementById(
                                  `filename-${row.id}`,
                                ) as HTMLInputElement
                              ).value || undefined,
                          }),
                        ),
                    })
                  }
                >
                  投放
                </Button>
                <Button
                  size="small"
                  danger
                  onClick={() =>
                    Modal.confirm({
                      title: "删除凭证？",
                      onOk: () =>
                        run(`delete-${row.id}`, () =>
                          unifiedApi.deleteCredential(row.id),
                        ),
                    })
                  }
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        title="完整凭证 JSON"
        open={Boolean(view)}
        onClose={() => setView(undefined)}
        width={680}
        extra={
          <Button
            icon={<DownloadOutlined />}
            onClick={() =>
              downloadJson(
                `${view?.credential.accountEmail}-${view?.credential.workspaceId}.json`,
                view?.content,
              )
            }
          >
            下载 JSON
          </Button>
        }
      >
        <Alert
          type="info"
          showIcon
          message="管理员调试视图完整展示凭证，不做脱敏。"
        />
        <JsonViewer title="凭证正文" value={view?.content} />
      </Drawer>
      <Modal
        title="替换凭证 JSON"
        open={Boolean(replacement)}
        onCancel={() => setReplacement(undefined)}
        footer={null}
        width={720}
      >
        <Alert
          type="warning"
          showIcon
          message="提交后会创建新凭证版本并停用当前凭证；JSON 中的 account_id 必须匹配当前 Workspace。"
        />
        <Input.TextArea
          className="raw-json"
          autoSize={{ minRows: 14, maxRows: 30 }}
          value={replacement?.json}
          onChange={(event) =>
            setReplacement((current) =>
              current ? { ...current, json: event.target.value } : current,
            )
          }
        />
        <Button
          type="primary"
          loading={busy === "replace-credential"}
          onClick={() => {
            if (!replacement) return;
            try {
              const content = parseCredentialReplacement(replacement.json);
              void run("replace-credential", () =>
                unifiedApi.replaceCredential(
                  replacement.credential.id,
                  content,
                ),
              ).then(() => setReplacement(undefined));
            } catch (e) {
              setViewError((e as Error).message);
              message.error((e as Error).message);
            }
          }}
        >
          创建替换版本
        </Button>
      </Modal>
      <Modal
        title="完成 OAuth 授权"
        open={Boolean(oauth)}
        onCancel={() => setOauth(undefined)}
        footer={null}
      >
        <Alert
          type="info"
          showIcon
          message="在新窗口完成授权，再粘贴完整回调 URL。"
        />
        <Typography.Paragraph copyable={{ text: oauth?.authUrl }}>
          {oauth?.authUrl}
        </Typography.Paragraph>
        <Input.TextArea
          rows={4}
          value={oauthCallback}
          onChange={(e) => setOauthCallback(e.target.value)}
          placeholder="完整 OAuth callback URL"
        />
        <Button
          type="primary"
          onClick={() =>
            oauth &&
            run("oauth-complete", () =>
              unifiedApi.completeOauthCredential(
                oauth.sessionId,
                oauthCallback,
                oauth.poolGroup,
              ),
            ).then(() => setOauth(undefined))
          }
        >
          完成 OAuth 凭证
        </Button>
      </Modal>
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
  return (
    <Table
      rowKey="id"
      dataSource={operations}
      scroll={{ x: 1000 }}
      columns={[
        { title: "时间", dataIndex: "updatedAt", render: formatTime },
        { title: "类型", dataIndex: "type" },
        { title: "状态", dataIndex: "status", render: (v) => <Tag>{v}</Tag> },
        { title: "阶段", dataIndex: "phase" },
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

function PaymentModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (value: any) => Promise<void>;
}) {
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
        <PaymentCardFields prefix="card" />
        <Button type="primary" htmlType="submit" loading={busy}>
          提交给 GAM
        </Button>
      </Form>
    </Modal>
  );
}
function StructuredObject({ value }: { value?: unknown }) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return <Typography.Text type="secondary">暂无结构化数据</Typography.Text>;
  return (
    <Descriptions
      bordered
      size="small"
      column={{ xs: 1, sm: 2 }}
      items={Object.entries(value)
        .filter(([, v]) => typeof v !== "object")
        .map(([key, item]) => ({
          key,
          label: key,
          children: String(item ?? "—"),
        }))}
    />
  );
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
function snapshotPayload(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  return asRecord(record?.payload) ?? record;
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
function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function mergeOperations<T extends { id: string; updatedAt: number }>(
  local: T[],
  remote: T[],
): T[] {
  const values = new Map(remote.map((item) => [item.id, item]));
  for (const item of local) if (!values.has(item.id)) values.set(item.id, item);
  return [...values.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

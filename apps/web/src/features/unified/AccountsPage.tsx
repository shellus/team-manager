import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import { DownOutlined, PlusOutlined, UpOutlined } from "@ant-design/icons";
import type {
  AccountGroupView,
  AccountRegistrationSummaryView,
  UnifiedAccountSummaryView,
} from "@team-manager/shared";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { unifiedApi } from "../../unifiedApi.js";
import {
  LoadBoundary,
  PageHeader,
  TriStateCheckboxFilter,
} from "../../components/ProductPrimitives.js";
import {
  accountListBooleanFilter,
  accountListRequestQuery,
  countAccountsByGroup,
  selectAccountsByGroup,
} from "./accountListModel.js";
import {
  AccountActionButtons,
  AccountActionModals,
} from "./AccountActions.js";
import {
  PRIMARY_PLAN_OPTIONS,
  accountRemarkLabel,
  lifecycleLabel,
  actionModalFromParams,
  primaryPlanLabel,
  setAccountActionInParams,
  type AccountActionModal,
  type AccountActionSummary,
} from "./accountActionsModel.js";
import { AccountOperationSummary, isActiveOperation } from "./AccountOperationSummary.js";
import { OperationDrawer } from "../../components/OperationDrawer.js";
import { useUrlPagination } from "../../components/urlPagination.js";

type AccountListRow = UnifiedAccountSummaryView | AccountRegistrationSummaryView;
function isRegistration(row: AccountListRow): row is AccountRegistrationSummaryView { return "kind" in row && row.kind === "registration"; }

const TRI_STATE_FILTERS = [
  ["hasGamBinding", "GAM"],
  ["hasRunningProfile", "Profile 运行"],
  ["isBanned", "封号"],
] as const;

export function AccountsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const committedQuery = params.get("query") ?? "";
  const [queryInput, setQueryInput] = useState(committedQuery);
  const [groups, setGroups] = useState<AccountGroupView[]>([]);
  const [matchingAccounts, setMatchingAccounts] = useState<
    UnifiedAccountSummaryView[]
  >([]);
  const [registrations, setRegistrations] = useState<AccountRegistrationSummaryView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const latestRequest = useRef(0);
  const modal = params.get("modal");
  const accountAction = actionModalFromParams(params);
  const actionAccountId = params.get("actionAccountId");
  const selectedGroupId = params.get("groupId") ?? undefined;
  const accountRequestQuery = accountListRequestQuery(params);
  const accountRequestKey = accountRequestQuery.toString();

  const accounts = useMemo(
    () => selectAccountsByGroup(matchingAccounts, selectedGroupId),
    [matchingAccounts, selectedGroupId],
  );
  const rows = useMemo<AccountListRow[]>(() => {
    const pending = selectedGroupId ? registrations.filter((item) => item.group.id === selectedGroupId) : registrations;
    return [...pending, ...accounts];
  }, [accounts, registrations, selectedGroupId]);
  const pagination = useUrlPagination({ total: rows.length, pageSizeStorageKey: "accounts" });
  const groupCounts = useMemo(
    () => countAccountsByGroup([...matchingAccounts, ...registrations]),
    [matchingAccounts, registrations],
  );
  const actionAccount = useMemo(
    () =>
      matchingAccounts.find((account) => account.id === actionAccountId) as
        | AccountActionSummary
        | undefined,
    [actionAccountId, matchingAccounts],
  );

  const fetchAccounts = async (query: URLSearchParams) => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError("");
    try {
      const [nextGroups, nextAccounts, nextRegistrations] = await Promise.all([
        unifiedApi.groups(),
        unifiedApi.accounts(query),
        unifiedApi.accountRegistrations(query),
      ]);
      if (requestId === latestRequest.current) {
        setGroups(nextGroups);
        setMatchingAccounts(nextAccounts);
        setRegistrations(nextRegistrations);
      }
    } catch (cause) {
      if (requestId === latestRequest.current) {
        setError((cause as Error).message);
      }
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  };

  const load = () => fetchAccounts(accountListRequestQuery(params));

  useEffect(() => {
    void fetchAccounts(new URLSearchParams(accountRequestKey));
  }, [accountRequestKey]);
  useEffect(() => {
    setQueryInput(committedQuery);
  }, [committedQuery]);
  useEffect(() => {
    if (![...matchingAccounts.map((item) => item.latestOperation), ...registrations.map((item) => item.operation)].some(isActiveOperation)) return;
    const timer = window.setInterval(load, 5_000);
    return () => window.clearInterval(timer);
  }, [matchingAccounts, registrations, accountRequestKey]);

  const set = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next);
  };
  const commitQuery = (value: string) => {
    const nextQuery = value.trim();
    setQueryInput(nextQuery);
    if (nextQuery === committedQuery) return;
    set("query", nextQuery || undefined);
  };
  const resetFilters = () => {
    setQueryInput("");
    setParams(new URLSearchParams());
  };
  const openAccountAction = (
    account: Pick<UnifiedAccountSummaryView, "id">,
    action: AccountActionModal,
  ) => setParams(setAccountActionInParams(params, action, account.id));
  const closeAccountAction = () =>
    setParams(setAccountActionInParams(params));

  const columns: TableColumnsType<AccountListRow> = [
    {
      title: "分组",
      dataIndex: ["group", "name"],
      fixed: "left",
      width: 140,
    },
    {
      title: "账号",
      fixed: "left",
      width: 370,
      render: (_, row) => (
        <div>
          <Space size={8}>
            {isRegistration(row) ? <Typography.Text strong>{row.email ?? "邮箱分配中"}</Typography.Text> : <Link to={`/accounts/${row.id}`} onClick={(event) => event.stopPropagation()}>
              <Typography.Text strong className="account-email-link">{row.email}</Typography.Text>
            </Link>}
            {!isRegistration(row) && row.isBanned && (
              <Badge status="error" text="封号" title="人工封号" />
            )}
            {!isRegistration(row) && row.accessHealth.status === "invalid" && <Badge status="error" text="登录无效" />}
            {!isRegistration(row) && row.lastError && <Badge status="error" text="同步失败" title={row.lastError} />}
            {!isRegistration(row) && ["failed", "interrupted"].includes(row.latestOperation?.status ?? "") && <Badge status="error" text="操作失败" />}
          </Space>
          <br />
          <Typography.Text type="secondary">{isRegistration(row) ? "注册中的临时账号" : accountRemarkLabel(row.remark)}</Typography.Text>
          {(isRegistration(row) ? row.operation : row.latestOperation) && <AccountOperationSummary operation={isRegistration(row) ? row.operation : row.latestOperation!} onOpen={(id) => set("operationId", id)} />}
        </div>
      ),
    },
    {
      title: "主套餐",
      dataIndex: "primaryPlan",
      width: 120,
      render: (_, row) => isRegistration(row) ? "—" : (
        <Tag color={row.primaryPlan === "free" ? "default" : "blue"}>
          {primaryPlanLabel(row.primaryPlan)}
        </Tag>
      ),
    },
    { title: "续费/到期", width: 150, render: (_, row) => isRegistration(row) ? "—" : lifecycleLabel(row.primaryPlanLifecycle) },
    {
      title: "能力",
      width: 90,
      render: (_, row) => !isRegistration(row) && row.hasGamBinding && <Tag color="green">GAM</Tag>,
    },
    {
      title: "操作",
      fixed: "right",
      width: 270,
      render: (_, row) => isRegistration(row) ? <Button size="small" onClick={() => set("operationId", row.operation.id)}>查看进度</Button> : (
        <AccountActionButtons
          account={row as AccountActionSummary}
          onOpen={(action) => openAccountAction(row, action)}
          onChanged={load}
        />
      ),
    },
  ];

  const reorder = async (index: number, delta: number) => {
    const copy = [...groups];
    const target = index + delta;
    if (target < 0 || target >= copy.length) return;
    [copy[index], copy[target]] = [copy[target], copy[index]];
    await unifiedApi.reorderGroups(copy.map((group) => group.id));
    await load();
  };

  return (
    <Card className="page-card">
      <Space direction="vertical" size={16} className="panel-stack">
        <PageHeader
          title="账号"
          description="账号运营与 Workspace 关系统一从账号进入"
          actions={
            <>
              <Button onClick={() => set("modal", "groups")}>管理分组</Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => navigate("/accounts/new")}
              >
                添加账号
              </Button>
            </>
          }
        />

        <div className="account-group-filter">
          <Typography.Text strong>账号分组</Typography.Text>
          <Radio.Group
            className="group-selector account-group-selector"
            value={selectedGroupId ?? ""}
            onChange={(event) => set("groupId", event.target.value || undefined)}
            aria-label="账号分组筛选"
          >
            <Radio.Button value="">
              <span className="account-group-option">
                全部
                <span className="account-group-count">
                  {matchingAccounts.length + registrations.length}
                </span>
              </span>
            </Radio.Button>
            {groups.map((group) => (
              <Radio.Button key={group.id} value={group.id}>
                <span className="account-group-option">
                  {group.name}
                  <span className="account-group-count">
                    {groupCounts.get(group.id) ?? 0}
                  </span>
                </span>
              </Radio.Button>
            ))}
          </Radio.Group>
        </div>

        <div className="filter-bar">
          <Input
            placeholder="邮箱、备注、名称"
            allowClear
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            onPressEnter={(event) => commitQuery(event.currentTarget.value)}
            onBlur={(event) => commitQuery(event.currentTarget.value)}
          />
          <Select
            allowClear
            placeholder="主套餐"
            value={params.get("primaryPlan") ?? undefined}
            onChange={(value) => set("primaryPlan", value)}
            options={[...PRIMARY_PLAN_OPTIONS]}
          />
          {TRI_STATE_FILTERS.map(([key, label]) => (
            <TriStateCheckboxFilter
              key={key}
              label={label}
              value={accountListBooleanFilter(params, key)}
              onChange={(value) => set(key, value)}
            />
          ))}
          <Button loading={loading} onClick={load}>刷新</Button>
          <Button onClick={resetFilters}>重置</Button>
        </div>

        <LoadBoundary
          loading={loading}
          error={error}
          empty={!rows.length}
          onRetry={load}
        >
          <Table<AccountListRow>
            rowKey="id"
            dataSource={rows}
            pagination={pagination}
            scroll={{ x: 1160 }}
            columns={columns}
          />
        </LoadBoundary>
      </Space>

      <Modal
        title="账号分组"
        open={modal === "groups"}
        onCancel={() => set("modal")}
        footer={null}
        width={700}
      >
        <Space direction="vertical" className="panel-stack">
          {groups.map((group, index) => (
            <Form
              key={group.id}
              className="group-row"
              initialValues={{ name: group.name }}
              onFinish={async (value) => {
                await unifiedApi.renameGroup(group.id, value.name);
                await load();
              }}
            >
              <Space wrap>
                <Button
                  icon={<UpOutlined />}
                  disabled={index === 0}
                  onClick={() => void reorder(index, -1)}
                />
                <Button
                  icon={<DownOutlined />}
                  disabled={index === groups.length - 1}
                  onClick={() => void reorder(index, 1)}
                />
                <Form.Item name="name" rules={[{ required: true }]} noStyle>
                  <Input disabled={group.isDefault} />
                </Form.Item>
                <Button htmlType="submit" disabled={group.isDefault}>
                  重命名
                </Button>
                <Button
                  danger
                  disabled={group.isDefault || group.accountCount > 0}
                  onClick={async () => {
                    await unifiedApi.deleteGroup(group.id);
                    await load();
                  }}
                >
                  删除
                </Button>
                <Typography.Text type="secondary">
                  {group.accountCount} 个账号
                </Typography.Text>
              </Space>
            </Form>
          ))}
          <Form
            layout="inline"
            onFinish={async (value) => {
              await unifiedApi.createGroup(value.name);
              await load();
            }}
          >
            <Form.Item name="name" rules={[{ required: true }]}>
              <Input placeholder="新分组名称" />
            </Form.Item>
            <Button htmlType="submit" type="primary">
              创建分组
            </Button>
          </Form>
        </Space>
      </Modal>
      <AccountActionModals
        account={actionAccount}
        action={accountAction}
        onClose={closeAccountAction}
        onChanged={load}
        onOperationCreated={(operation) => {
          const next = setAccountActionInParams(params);
          next.set("operationId", operation.id);
          setParams(next);
          void load();
        }}
      />
      <OperationDrawer operationId={params.get("operationId") ?? undefined} open={Boolean(params.get("operationId"))} onClose={() => set("operationId")} onChanged={load} />
    </Card>
  );
}

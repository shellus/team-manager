import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
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
  showsBannedAccounts,
} from "./accountListModel.js";
import {
  AccountActionButtons,
  AccountActionModals,
} from "./AccountActions.js";
import {
  PRIMARY_PLAN_OPTIONS,
  accountRemarkLabel,
  actionModalFromParams,
  primaryPlanLabel,
  setAccountActionInParams,
  type AccountActionModal,
  type AccountActionSummary,
} from "./accountActionsModel.js";

const TRI_STATE_FILTERS = [
  ["hasGamBinding", "GAM"],
  ["hasRunningProfile", "Profile 运行"],
] as const;

export function AccountsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [groups, setGroups] = useState<AccountGroupView[]>([]);
  const [matchingAccounts, setMatchingAccounts] = useState<
    UnifiedAccountSummaryView[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const latestRequest = useRef(0);
  const modal = params.get("modal");
  const accountAction = actionModalFromParams(params);
  const actionAccountId = params.get("actionAccountId");
  const selectedGroupId = params.get("groupId") ?? undefined;
  const showBanned = showsBannedAccounts(params);
  const accountRequestQuery = accountListRequestQuery(params);
  const accountRequestKey = accountRequestQuery.toString();

  const accounts = useMemo(
    () => selectAccountsByGroup(matchingAccounts, selectedGroupId),
    [matchingAccounts, selectedGroupId],
  );
  const groupCounts = useMemo(
    () => countAccountsByGroup(matchingAccounts),
    [matchingAccounts],
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
      const [nextGroups, nextAccounts] = await Promise.all([
        unifiedApi.groups(),
        unifiedApi.accounts(query),
      ]);
      if (requestId === latestRequest.current) {
        setGroups(nextGroups);
        setMatchingAccounts(nextAccounts);
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

  const set = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next);
  };
  const openAccountAction = (
    account: Pick<UnifiedAccountSummaryView, "id">,
    action: AccountActionModal,
  ) => setParams(setAccountActionInParams(params, action, account.id));
  const closeAccountAction = () =>
    setParams(setAccountActionInParams(params));

  const columns: TableColumnsType<UnifiedAccountSummaryView> = [
    {
      title: "账号",
      fixed: "left",
      width: 250,
      render: (_, row) => (
        <div>
          <Space size={8}>
            <Link to={`/accounts/${row.id}`} onClick={(event) => event.stopPropagation()}>
              <Typography.Text strong className="account-email-link">
                {row.email}
              </Typography.Text>
            </Link>
            {row.isBanned && (
              <Badge status="error" text="封号" title="人工封号" />
            )}
          </Space>
          <br />
          <Typography.Text type="secondary">
            {accountRemarkLabel(row.remark)}
          </Typography.Text>
        </div>
      ),
    },
    { title: "分组", dataIndex: ["group", "name"], width: 140 },
    {
      title: "主套餐",
      dataIndex: "primaryPlan",
      width: 120,
      render: (_, row) => (
        <Tag color={row.primaryPlan === "free" ? "default" : "blue"}>
          {primaryPlanLabel(row.primaryPlan)}
        </Tag>
      ),
    },
    {
      title: "能力",
      width: 90,
      render: (_, row) => row.hasGamBinding && <Tag color="green">GAM</Tag>,
    },
    {
      title: "操作",
      fixed: "right",
      width: 270,
      render: (_, row: AccountActionSummary) => (
        <AccountActionButtons
          account={row}
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
                  {matchingAccounts.length}
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
          <Input.Search
            placeholder="邮箱、备注、名称"
            allowClear
            value={params.get("query") ?? ""}
            onChange={(event) => set("query", event.target.value)}
            onSearch={(value) => set("query", value)}
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
          <Checkbox
            className="show-banned-filter"
            checked={showBanned}
            onChange={(event) =>
              set("showBanned", event.target.checked ? "true" : undefined)
            }
          >
            显示封号
          </Checkbox>
          <Button onClick={() => setParams(new URLSearchParams())}>
            清除筛选
          </Button>
        </div>

        <LoadBoundary
          loading={loading}
          error={error}
          empty={!accounts.length}
          onRetry={load}
        >
          <Table<UnifiedAccountSummaryView>
            rowKey="id"
            dataSource={accounts}
            scroll={{ x: 1000 }}
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
      />
    </Card>
  );
}

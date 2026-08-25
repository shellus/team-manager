import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  unifiedApi,
  type CredentialPoolGroupView,
  type NotificationDeliveryView,
  type NotificationPolicyView,
} from "../../unifiedApi.js";
import {
  LoadBoundary,
  PageHeader,
  formatTime,
} from "../../components/ProductPrimitives.js";
import { notificationDeliveryPresentation } from "./unifiedUiModels.js";
import { setWebPreferences } from "../../webPreferences.js";
import { useUrlPagination } from "../../components/urlPagination.js";

type SystemSetting = { key: string; value?: Record<string, unknown> };

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const [policies, setPolicies] = useState<NotificationPolicyView[]>([]);
  const [deliveries, setDeliveries] = useState<NotificationDeliveryView[]>([]);
  const [groups, setGroups] = useState<CredentialPoolGroupView[]>([]);
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    const result = await Promise.allSettled([
      unifiedApi.notificationPolicies(),
      unifiedApi.notificationDeliveries(),
      unifiedApi.credentialPoolGroups(),
      unifiedApi.systemSettings(),
    ]);
    if (result[0].status === "fulfilled") setPolicies(result[0].value);
    if (result[1].status === "fulfilled") setDeliveries(result[1].value);
    if (result[2].status === "fulfilled") setGroups(result[2].value);
    if (result[3].status === "fulfilled") setSettings(result[3].value);
    const failures = result.filter((item) => item.status === "rejected");
    if (failures.length)
      setError(failures.map((item) => String(item.reason)).join("\n"));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try {
      await action();
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  };

  const valueOf = (key: string) =>
    settings.find((row) => row.key === key)?.value;
  const tabs = ["notifications", "deliveries", "pools", "preferences", "retention"];
  const activeTab = tabs.includes(params.get("tab") ?? "") ? params.get("tab")! : "notifications";
  const deliveryPagination = useUrlPagination({ total: deliveries.length, pageKey: "deliveriesPage", pageSizeStorageKey: "notification-deliveries" });
  const selectTab = (value: string) => { const next = new URLSearchParams(params); value === "notifications" ? next.delete("tab") : next.set("tab", value); setParams(next); };
  useEffect(()=>{const tab=params.get("tab");if(tab&&!tabs.includes(tab)){const next=new URLSearchParams(params);next.delete("tab");setParams(next,{replace:true});}},[params,setParams]);
  useEffect(()=>{const policy=params.get("policy");if(policy&&policy!=="new"&&policies.length&&!policies.some(row=>row.kind===policy)){const next=new URLSearchParams(params);next.delete("policy");setParams(next,{replace:true});}},[params,policies,setParams]);

  return (
    <Space direction="vertical" size={16} className="panel-stack">
      <Card>
        <PageHeader
          title="系统设置"
          description="通知、号池分组、制品生命周期和 Web 偏好统一保存到 PostgreSQL"
        />
      </Card>
      {error && <Alert type="error" showIcon message={error} />}
      <Card>
        <LoadBoundary loading={loading} error={error} onRetry={load}>
          <Tabs
            activeKey={activeTab}
            onChange={selectTab}
            items={[
              {
                key: "notifications",
                label: "通知策略",
                children: (
                  <NotificationPolicies
                    policies={policies}
                    busy={busy}
                    run={run}
                    selectedKind={params.get("policy") ?? policies[0]?.kind}
                    onSelect={(kind) => { const next = new URLSearchParams(params); next.set("policy", kind ?? "new"); setParams(next); }}
                  />
                ),
              },
              {
                key: "deliveries",
                label: `投递历史 (${deliveries.length})`,
                children: (
                  <NotificationDeliveries
                    deliveries={deliveries}
                    pagination={deliveryPagination}
                    busy={busy}
                    run={run}
                  />
                ),
              },
              {
                key: "pools",
                label: `凭证号池组 (${groups.length})`,
                children: <CredentialPoolGroups groups={groups} run={run} />,
              },
              {
                key: "preferences",
                label: "Web 偏好",
                children: (
                  <Form
                    key={JSON.stringify(valueOf("web.preferences"))}
                    layout="vertical"
                    initialValues={valueOf("web.preferences")}
                    onFinish={(value) =>
                      run("web-preferences", async () => {
                        const saved = await unifiedApi.saveSystemSetting(
                          "web.preferences",
                          value,
                        );
                        setWebPreferences(value);
                        return saved;
                      })
                    }
                  >
                    <div className="switch-grid">
                      <Form.Item
                        name="rememberFormValues"
                        label="记住表单值"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                      <Form.Item
                        name="autoRefreshOperations"
                        label="自动刷新操作"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                    </div>
                    <Button
                      htmlType="submit"
                      type="primary"
                      loading={busy === "web-preferences"}
                    >
                      保存 Web 偏好
                    </Button>
                  </Form>
                ),
              },
              {
                key: "retention",
                label: "制品保留",
                children: (
                  <Form
                    key={JSON.stringify(valueOf("artifact_retention"))}
                    layout="vertical"
                    initialValues={
                      valueOf("artifact_retention") ?? {
                        traceDays: 30,
                        rrwebDays: 14,
                        graceHours: 24,
                      }
                    }
                    onFinish={(value) =>
                      run("artifact-retention", () =>
                        unifiedApi.saveSystemSetting(
                          "artifact_retention",
                          value,
                        ),
                      )
                    }
                  >
                    <Typography.Paragraph type="secondary">
                      Trace 与 rrweb
                      分别设置保留天数；进入待删除状态后，再经过宽限时间才允许物理清理。
                    </Typography.Paragraph>
                    <div className="responsive-form-grid">
                      <Form.Item
                        name="traceDays"
                        label="HTTP trace 保留天数"
                        rules={[{ required: true }]}
                      >
                        <InputNumber min={1} precision={0} />
                      </Form.Item>
                      <Form.Item
                        name="rrwebDays"
                        label="rrweb 保留天数"
                        rules={[{ required: true }]}
                      >
                        <InputNumber min={1} precision={0} />
                      </Form.Item>
                      <Form.Item
                        name="graceHours"
                        label="待删除宽限小时"
                        rules={[{ required: true }]}
                      >
                        <InputNumber min={0} precision={0} />
                      </Form.Item>
                    </div>
                    <Button
                      htmlType="submit"
                      type="primary"
                      loading={busy === "artifact-retention"}
                    >
                      保存制品保留策略
                    </Button>
                  </Form>
                ),
              },
            ]}
          />
        </LoadBoundary>
      </Card>
    </Space>
  );
}

function notificationChannels(configuration: NotificationPolicyView["configuration"]) {
  return [configuration.webhookEnabled && configuration.webhookUrl && "通用 Webhook", configuration.feishuEnabled && configuration.feishuWebhookUrl && "飞书", configuration.wecomEnabled && configuration.wecomWebhookUrl && "企业微信", configuration.telegramEnabled && configuration.telegramBotToken && configuration.telegramChatId && "Telegram"].filter((value): value is string => Boolean(value));
}
function deliveryChannelNames(channels:string[]){const labels:Record<string,string>={webhook:"通用 Webhook",feishu:"飞书",wecom:"企业微信",telegram:"Telegram"};return channels.map(channel=>labels[channel]??channel).join("、")||"—";}

function NotificationPolicies({
  policies,
  busy,
  run,
  selectedKind,
  onSelect,
}: {
  policies: NotificationPolicyView[];
  busy: string;
  run: (key: string, action: () => Promise<unknown>) => Promise<void>;
  selectedKind?: string;
  onSelect: (kind?: string) => void;
}) {
  const selected = policies.find((policy) => policy.kind === selectedKind);
  return (
    <Space direction="vertical" className="panel-stack">
      <Table
        rowKey="id"
        pagination={false}
        dataSource={policies}
        scroll={{ x: 900 }}
        columns={[
          { title: "策略", dataIndex: "kind" },
          {
            title: "启用",
            dataIndex: "enabled",
            render: (value) => (value ? <Tag color="green">是</Tag> : "否"),
          },
          {
            title: "提醒时间",
            render: (_, row) => `提前 ${row.configuration.advanceDays} 天，${row.configuration.triggerTime}（${row.configuration.timeZone}）`,
          },
          {
            title: "渠道",
            render: (_, row) => notificationChannels(row.configuration).join("、") || "未配置",
          },
          {
            title: "操作",
            render: (_, row) => (
              <Space><Button onClick={() => onSelect(row.kind)}>编辑</Button><Button loading={busy === `test-${row.kind}`} onClick={() => run(`test-${row.kind}`, () => unifiedApi.testNotificationPolicy(row.kind))}>发送测试</Button></Space>
            ),
          },
        ]}
      />
      <Form
        key={selected?.id ?? "new-policy"}
        layout="vertical"
        initialValues={{ kind: selected?.kind ?? "seat_expiration", enabled: selected?.enabled ?? true, advanceDays: selected?.configuration.advanceDays ?? 7, triggerTime: selected?.configuration.triggerTime ?? "09:00", timeZone: selected?.configuration.timeZone ?? "Asia/Shanghai", managementUrl:selected?.configuration.managementUrl, webhookEnabled: selected?.configuration.webhookEnabled ?? false, feishuEnabled: selected?.configuration.feishuEnabled ?? false, wecomEnabled: selected?.configuration.wecomEnabled ?? false, telegramEnabled: selected?.configuration.telegramEnabled ?? false, webhookUrl: selected?.configuration.webhookUrl, feishuWebhookUrl: selected?.configuration.feishuWebhookUrl, telegramBotToken: selected?.configuration.telegramBotToken, telegramChatId: selected?.configuration.telegramChatId, wecomWebhookUrl: selected?.configuration.wecomWebhookUrl }}
        onFinish={(value) => run("policy", () => unifiedApi.saveNotificationPolicy(value.kind, { enabled: value.enabled === true, configuration: { advanceDays: value.advanceDays, triggerTime: value.triggerTime, timeZone: value.timeZone, webhookEnabled:value.webhookEnabled===true,feishuEnabled:value.feishuEnabled===true,wecomEnabled:value.wecomEnabled===true,telegramEnabled:value.telegramEnabled===true, ...(value.managementUrl ? { managementUrl:value.managementUrl } : {}), ...(value.webhookUrl ? { webhookUrl: value.webhookUrl } : {}), ...(value.feishuWebhookUrl ? { feishuWebhookUrl: value.feishuWebhookUrl } : {}), ...(value.telegramBotToken ? { telegramBotToken: value.telegramBotToken } : {}), ...(value.telegramChatId ? { telegramChatId: value.telegramChatId } : {}), ...(value.wecomWebhookUrl ? { wecomWebhookUrl: value.wecomWebhookUrl } : {}) } }))}
      >
        <Typography.Title level={4}>{selected ? `编辑 ${selected.kind}` : "新建通知策略"}</Typography.Title>
        <div className="responsive-form-grid">
          <Form.Item name="kind" label="提醒类型" rules={[{ required: true }]}>
            <Select disabled={Boolean(selected)} options={[{value:"seat_expiration",label:"客户席位到期"},{value:"workspace_renewal",label:"Team Workspace 续费"}]} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>
        <Form.Item name="managementUrl" label="通知管理入口" rules={[{ type:"url", message:"请输入完整的 HTTP(S) URL" }]} extra="通知正文末尾的管理页面链接；席位策略建议填写席位概览，续费策略建议填写母号概览。"><Input allowClear maxLength={500} placeholder="https://example.com/seat-overview" /></Form.Item>
        <div className="responsive-form-grid">
          <Form.Item name="advanceDays" label="提前提醒天数" rules={[{ required: true }]}><InputNumber min={0} max={365} precision={0} /></Form.Item>
          <Form.Item name="triggerTime" label="每日触发时间" rules={[{ required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ }]}><Input type="time" /></Form.Item>
          <Form.Item name="timeZone" label="时区" rules={[{ required: true }]}><Select showSearch options={["Asia/Shanghai", "UTC", "America/Los_Angeles", "America/New_York", "Europe/London"].map(value => ({ value, label: value }))} /></Form.Item>
        </div>
        <Typography.Text type="secondary">渠道开关与地址分开保存；关闭渠道不会删除已填配置。Telegram 需要同时填写 Bot Token 与 Chat ID。</Typography.Text>
        <div className="notification-channel-grid">
          <div className="notification-channel-card"><Form.Item name="webhookEnabled" label="启用通用 Webhook" valuePropName="checked"><Switch /></Form.Item><Form.Item name="webhookUrl" label="Webhook URL"><Input allowClear /></Form.Item></div>
          <div className="notification-channel-card"><Form.Item name="feishuEnabled" label="启用飞书" valuePropName="checked"><Switch /></Form.Item><Form.Item name="feishuWebhookUrl" label="飞书 Webhook"><Input allowClear /></Form.Item></div>
          <div className="notification-channel-card"><Form.Item name="wecomEnabled" label="启用企业微信" valuePropName="checked"><Switch /></Form.Item><Form.Item name="wecomWebhookUrl" label="企业微信 Webhook"><Input allowClear /></Form.Item></div>
          <div className="notification-channel-card"><Form.Item name="telegramEnabled" label="启用 Telegram" valuePropName="checked"><Switch /></Form.Item><Form.Item name="telegramBotToken" label="Bot Token"><Input allowClear /></Form.Item><Form.Item name="telegramChatId" label="Chat ID"><Input allowClear /></Form.Item></div>
        </div>
        <Button htmlType="submit" type="primary" loading={busy === "policy"}>
          保存通知策略
        </Button>
        {selected && <Button onClick={() => onSelect(undefined)}>新建策略</Button>}
      </Form>
    </Space>
  );
}

function NotificationDeliveries({
  deliveries,
  pagination,
  busy,
  run,
}: {
  deliveries: NotificationDeliveryView[];
  pagination: ReturnType<typeof useUrlPagination>;
  busy: string;
  run: (key: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <Table
      rowKey="id"
      dataSource={deliveries}
      pagination={pagination}
      scroll={{ x: 900 }}
      columns={[
        { title: "时间", dataIndex: "createdAt", render: formatTime },
        { title: "策略", dataIndex: "kind" },
        {
          title: "状态",
          render: (_, row) => {
            const state = notificationDeliveryPresentation(row);
            return (
              <Space direction="vertical" size={0}>
                <Tag color={state.color}>{state.label}</Tag>
                <Typography.Text type="secondary">
                  {state.detail}
                </Typography.Text>
              </Space>
            );
          },
        },
        { title: "错误", dataIndex: "error" },
        { title:"渠道",render:(_,row)=> <Space direction="vertical" size={0}><Typography.Text>{deliveryChannelNames(row.deliveredChannels)} 已成功</Typography.Text>{row.pendingChannels.length>0&&<Typography.Text type="secondary">待发送：{deliveryChannelNames(row.pendingChannels)}</Typography.Text>}</Space> },
        {
          title: "投递摘要",
          dataIndex: "summaryText",
        },
        {
          title: "操作",
          render: (_, row) => {
            const state = notificationDeliveryPresentation(row);
            return state.canRetry ? (
              <Button
                size="small"
                loading={busy === `delivery-${row.id}`}
                onClick={() =>
                  run(`delivery-${row.id}`, () =>
                    unifiedApi.retryNotificationDelivery(row.id),
                  )
                }
              >
                重试投递
              </Button>
            ) : row.status === "exhausted" ||
              row.attemptCount >= row.maxAttempts ? (
              <Typography.Text type="secondary">有限重试已耗尽</Typography.Text>
            ) : (
              "—"
            );
          },
        },
      ]}
    />
  );
}

function CredentialPoolGroups({
  groups,
  run,
}: {
  groups: CredentialPoolGroupView[];
  run: (key: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <Space direction="vertical" className="panel-stack">
      {groups.map((group) => (
        <Form
          key={group.id}
          layout="inline"
          initialValues={{ name: group.name, sortOrder: group.sortOrder }}
          onFinish={(value) =>
            run(`group-${group.id}`, () =>
              unifiedApi.updateCredentialPoolGroup(group.id, value),
            )
          }
        >
          <Form.Item name="name">
            <Input />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序">
            <InputNumber precision={0} />
          </Form.Item>
          <Button htmlType="submit">保存分组</Button>
          <Button
            danger
            disabled={Boolean(group.credentialCount)}
            onClick={() =>
              run(`delete-${group.id}`, () =>
                unifiedApi.deleteCredentialPoolGroup(group.id),
              )
            }
          >
            删除
          </Button>
          <span>{group.credentialCount ?? 0} 个凭证</span>
        </Form>
      ))}
      <Form
        layout="inline"
        onFinish={(value) =>
          run("new-group", () =>
            unifiedApi.createCredentialPoolGroup(value.name),
          )
        }
      >
        <Form.Item name="name" rules={[{ required: true }]}>
          <Input placeholder="新号池组名称" />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          创建号池组
        </Button>
      </Form>
    </Space>
  );
}

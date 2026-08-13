import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
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
} from "../../unifiedApi.js";
import {
  JsonViewer,
  LoadBoundary,
  PageHeader,
  formatTime,
} from "../../components/ProductPrimitives.js";

type SystemSetting = { key: string; value?: Record<string, unknown> };

export function SettingsPage() {
  const [policies, setPolicies] = useState<Array<Record<string, unknown>>>([]);
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
            items={[
              {
                key: "notifications",
                label: "通知策略",
                children: (
                  <NotificationPolicies
                    policies={policies}
                    busy={busy}
                    run={run}
                    setError={setError}
                  />
                ),
              },
              {
                key: "deliveries",
                label: `投递历史 (${deliveries.length})`,
                children: (
                  <NotificationDeliveries
                    deliveries={deliveries}
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
                        window.dispatchEvent(
                          new CustomEvent("team-manager:web-preferences", {
                            detail: value,
                          }),
                        );
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
                      <Form.Item
                        name="rrwebEnabled"
                        label="启用 rrweb 录制工具"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                    </div>
                    <Alert
                      type="warning"
                      showIcon
                      message="rrweb 开启后由管理员手动开始录制；所有输入值（包括密码）均按原文记录。"
                    />
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
              {
                key: "raw",
                label: "原始设置",
                children: (
                  <JsonViewer title="系统设置原始 JSON" value={settings} />
                ),
              },
            ]}
          />
        </LoadBoundary>
      </Card>
    </Space>
  );
}

function NotificationPolicies({
  policies,
  busy,
  run,
  setError,
}: {
  policies: Array<Record<string, unknown>>;
  busy: string;
  run: (key: string, action: () => Promise<unknown>) => Promise<void>;
  setError: (value: string) => void;
}) {
  return (
    <Space direction="vertical" className="panel-stack">
      <Table
        rowKey={(row) => String(row.kind)}
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
            title: "配置",
            dataIndex: "configuration",
            render: (value) => (
              <JsonViewer title="查看完整配置" value={value} />
            ),
          },
          {
            title: "操作",
            render: (_, row) => (
              <Button
                loading={busy === `test-${row.kind}`}
                onClick={() =>
                  run(`test-${row.kind}`, () =>
                    unifiedApi.testNotificationPolicy(String(row.kind)),
                  )
                }
              >
                发送测试
              </Button>
            ),
          },
        ]}
      />
      <Form
        layout="vertical"
        onFinish={async (value) => {
          let configuration = {};
          try {
            configuration = value.configuration
              ? JSON.parse(value.configuration)
              : {};
          } catch {
            setError("配置必须是 JSON 对象");
            return;
          }
          await run("policy", () =>
            unifiedApi.saveNotificationPolicy(value.kind, {
              enabled: value.enabled === true,
              configuration,
            }),
          );
        }}
      >
        <div className="responsive-form-grid">
          <Form.Item name="kind" label="策略键" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>
        <Form.Item name="configuration" label="配置 JSON">
          <Input.TextArea rows={6} />
        </Form.Item>
        <Button htmlType="submit" type="primary" loading={busy === "policy"}>
          保存通知策略
        </Button>
      </Form>
    </Space>
  );
}

function NotificationDeliveries({
  deliveries,
  busy,
  run,
}: {
  deliveries: NotificationDeliveryView[];
  busy: string;
  run: (key: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <Table
      rowKey="id"
      dataSource={deliveries}
      scroll={{ x: 900 }}
      columns={[
        { title: "时间", dataIndex: "createdAt", render: formatTime },
        { title: "策略", dataIndex: "kind" },
        {
          title: "状态",
          dataIndex: "status",
          render: (value) => <Tag>{value}</Tag>,
        },
        { title: "错误", dataIndex: "error" },
        {
          title: "投递摘要",
          dataIndex: "summary",
          render: (value) => <JsonViewer title="查看摘要" value={value} />,
        },
        {
          title: "操作",
          render: (_, row) =>
            row.status === "failed" ? (
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
            ) : (
              "—"
            ),
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
          initialValues={{ name: group.name }}
          onFinish={(value) =>
            run(`group-${group.id}`, () =>
              unifiedApi.updateCredentialPoolGroup(group.id, value),
            )
          }
        >
          <Form.Item name="name">
            <Input />
          </Form.Item>
          <Button htmlType="submit">重命名</Button>
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

import { useCallback, useEffect, useState } from 'react';
import type {
  AccountView,
  MaintainedTeamOrder,
  TeamOrderConfig,
  TeamOrderConfigOverrides,
  TeamOrderMaintenanceView
} from '@team-manager/shared';
import { Alert, App, Button, Card, Descriptions, Form, Popconfirm, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, PauseOutlined, PlayCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { apiClient } from '../../api.js';
import { formatDateTime } from '../../components/format.js';
import { TeamOrderConfigFields } from '../team-orders/TeamOrderConfigFields.js';
import { TeamOrderHistoryTable } from '../team-orders/TeamOrderHistoryTable.js';
import { teamOrderRetryMode } from '../team-orders/teamOrderPresentation.js';

const CODEX_SPACE_PLAN = 'self_serve_business_usage_based';

export function ParentOrderMaintenancePanel({ account }: { account: AccountView }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<TeamOrderConfigOverrides>();
  const [view, setView] = useState<TeamOrderMaintenanceView | null>(null);
  const [globalConfig, setGlobalConfig] = useState<TeamOrderConfig>({ promoCode: '', country: 'US', currency: 'USD' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState('');
  const eligible = account.planType === CODEX_SPACE_PLAN && !account.hasTeamSubscription;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const dashboard = await apiClient.getTeamOrderDashboard();
      const current = dashboard.items.find((item) => item.account.id === account.id) ?? null;
      setGlobalConfig(dashboard.globalConfig);
      setView(current);
      if (!silent || !form.isFieldsTouched()) {
        form.setFieldsValue(current?.maintenance.overrides ?? { promoCode: '', country: undefined, currency: undefined });
      }
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [account.id, form, message]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!view?.orders.some((order) => order.status === 'queued' || order.status === 'running')) return;
    const timer = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(timer);
  }, [load, view?.orders]);

  const save = async (values: TeamOrderConfigOverrides) => {
    setSaving(true);
    try {
      const updated = await apiClient.saveAccountTeamOrderMaintenance(account.id, values);
      setView(updated);
      form.setFieldsValue(updated.maintenance.overrides);
      message.success(view ? '母号订单配置已更新' : '母号已加入订单维护池');
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    setAction('generate');
    try {
      await apiClient.generateAccountTeamOrder(account.id);
      message.success('已加入生成队列，本次手动任务不会改变自动周期');
      await load(true);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setAction('');
    }
  };

  const togglePaused = async () => {
    if (!view) return;
    setAction('pause');
    try {
      const updated = await apiClient.setAccountTeamOrderPaused(account.id, view.maintenance.status === 'active');
      setView(updated);
      message.success(updated.maintenance.status === 'active' ? '订单维护已恢复' : '订单维护已暂停');
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setAction('');
    }
  };

  const remove = async () => {
    setAction('remove');
    try {
      await apiClient.removeAccountTeamOrderMaintenance(account.id);
      setView(null);
      form.resetFields();
      message.success('已移出订单维护池，历史订单仍按运行数据保留');
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setAction('');
    }
  };

  const retryOrder = async (order: MaintainedTeamOrder) => {
    setAction(`retry-${order.id}`);
    try {
      await apiClient.retryAccountTeamOrder(account.id, order.id);
      message.success(teamOrderRetryMode(order) === 'expedite' ? '已提前执行下一次重试' : '已创建新的订单任务');
      await load(true);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setAction('');
    }
  };

  if (loading) return <Card loading />;

  return (
    <Space direction="vertical" size={16} className="panel-stack">
      {!eligible && (
        <Alert
          type={account.hasTeamSubscription ? 'success' : 'warning'}
          showIcon
          message={account.hasTeamSubscription ? '该 Workspace 已开通 Team' : '当前母号不符合订单维护条件'}
          description={account.hasTeamSubscription
            ? '无需继续生成升级订单；已有维护记录会在调度器检测到 Team 订阅后自动暂停。'
            : '只有已开通 Codex Workspace（self_serve_business_usage_based）的母号可以加入维护池。'}
        />
      )}

      <Card
        title={view ? '维护配置' : '加入订单维护池'}
        extra={view && (
          <Space wrap>
            <Tag color={view.maintenance.status === 'active' ? 'processing' : 'warning'}>
              {view.maintenance.status === 'active' ? '维护中' : '已暂停'}
            </Tag>
            <Button
              size="small"
              icon={view.maintenance.status === 'active' ? <PauseOutlined /> : <PlayCircleOutlined />}
              loading={action === 'pause'}
              disabled={!eligible && view.maintenance.status === 'paused'}
              onClick={() => void togglePaused()}
            >
              {view.maintenance.status === 'active' ? '暂停' : '恢复'}
            </Button>
            <Popconfirm title="将该母号移出订单维护池？" description="不会删除已有订单历史。" onConfirm={() => void remove()}>
              <Button size="small" danger icon={<DeleteOutlined />} loading={action === 'remove'}>移出</Button>
            </Popconfirm>
          </Space>
        )}
      >
        <Typography.Paragraph type="secondary">
          每 8 小时自动生成一个指向当前 Codex Workspace 的普通两席位 Team 升级订单。空白字段继承全局配置；保存后不会立即生成，首次自动任务会分散到 10 分钟窗口内。
        </Typography.Paragraph>
        {view?.maintenance.pauseReason && (
          <Alert className="team-order-inline-alert" type="warning" showIcon message={view.maintenance.pauseReason} />
        )}
        <Form<TeamOrderConfigOverrides>
          form={form}
          layout="vertical"
          disabled={!eligible}
          onFinish={(values) => void save(values)}
        >
          <TeamOrderConfigFields inherit={globalConfig} />
          <Space wrap>
            <Button type="primary" htmlType="submit" loading={saving} disabled={!eligible}>
              {view ? '保存母号配置' : '加入维护池'}
            </Button>
            {view && (
              <Popconfirm
                title="立即重新生成订单？"
                description="会立即加入队列，但不会改变 8 小时自动周期。"
                okText="立即生成"
                cancelText="取消"
                onConfirm={() => void generate()}
              >
                <Button
                  icon={<ThunderboltOutlined />}
                  loading={action === 'generate'}
                  disabled={!eligible || view.maintenance.status !== 'active' || view.orders.some((order) => order.status === 'queued' || order.status === 'running')}
                >
                  立即生成
                </Button>
              </Popconfirm>
            )}
          </Space>
        </Form>
      </Card>

      {view && (
        <Card title="运行状态">
          <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
            <Descriptions.Item label="最终优惠码">{view.effectiveConfig.promoCode || '无'}</Descriptions.Item>
            <Descriptions.Item label="最终国家 / 货币">{view.effectiveConfig.country} / {view.effectiveConfig.currency}</Descriptions.Item>
            <Descriptions.Item label="下次自动生成">{view.maintenance.status === 'active' ? formatDateTime(view.maintenance.nextRunAt) : '已暂停'}</Descriptions.Item>
            <Descriptions.Item label="最近成功">{formatDateTime(view.maintenance.lastSuccessAt)}</Descriptions.Item>
            <Descriptions.Item label="最近错误" span={2}>{view.maintenance.lastError || '无'}</Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {view && (
        <Card title={`订单历史（${view.orders.length}/30）`}>
          <TeamOrderHistoryTable
            orders={view.orders}
            retryingOrderId={action.startsWith('retry-') ? action.slice('retry-'.length) : undefined}
            onRetry={(order) => void retryOrder(order)}
          />
        </Card>
      )}
    </Space>
  );
}

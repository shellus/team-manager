import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  MaintainedTeamOrder,
  TeamOrderConfig,
  TeamOrderConfigOverrides,
  TeamOrderDashboardView,
  TeamOrderMaintenanceView
} from '@team-manager/shared';
import {
  Alert,
  App,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  RedoOutlined,
  ReloadOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../../api.js';
import { formatDateTime } from '../../components/format.js';
import { setSearchValue } from '../../app/routeState.js';
import { TeamOrderConfigFields } from './TeamOrderConfigFields.js';
import { TeamOrderHistoryTable } from './TeamOrderHistoryTable.js';
import { TeamOrderStatusTag } from './TeamOrderStatusTag.js';
import { presentedTeamOrderStatus, teamOrderRemainingText, teamOrderRetryMode } from './teamOrderPresentation.js';
import {
  clearTeamOrderPageModalState,
  parseTeamOrderPageModalState,
  setTeamOrderPageModalState
} from './teamOrderPageState.js';

type MaintenanceFilter = 'all' | 'active' | 'paused' | 'attention';

function matchesFilter(item: TeamOrderMaintenanceView, filter: MaintenanceFilter, now: number): boolean {
  if (filter === 'active') return item.maintenance.status === 'active';
  if (filter === 'paused') return item.maintenance.status === 'paused';
  if (filter === 'attention') {
    const latest = item.orders[0];
    return Boolean(item.maintenance.lastError || item.maintenance.pauseReason || (latest && ['failed', 'expired', 'expiring'].includes(presentedTeamOrderStatus(latest, now))));
  }
  return true;
}

export function TeamOrdersPage({ onError }: { onError: (error: unknown) => void }) {
  const { message } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<TeamOrderConfig>();
  const [maintenanceForm] = Form.useForm<TeamOrderConfigOverrides>();
  const [dashboard, setDashboard] = useState<TeamOrderDashboardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [batching, setBatching] = useState(false);
  const [retryingOrderId, setRetryingOrderId] = useState('');
  const [editingMaintenance, setEditingMaintenance] = useState(false);
  const [removingMaintenance, setRemovingMaintenance] = useState(false);
  const [now, setNow] = useState(Date.now());
  const query = searchParams.get('q') ?? '';
  const rawFilter = searchParams.get('status') ?? 'all';
  const filter: MaintenanceFilter = ['active', 'paused', 'attention'].includes(rawFilter)
    ? rawFilter as MaintenanceFilter
    : 'all';
  const expanded = (searchParams.get('expanded') ?? '').split(',').filter(Boolean);
  const modalState = parseTeamOrderPageModalState(searchParams);
  const selectedMaintenance = dashboard?.items.find((item) => item.account.id === modalState.target) ?? null;

  useEffect(() => {
    if (modalState.modal !== 'edit-maintenance' || !selectedMaintenance) return;
    maintenanceForm.resetFields();
    maintenanceForm.setFieldsValue({
      promoCode: selectedMaintenance.maintenance.overrides.promoCode ?? '',
      country: selectedMaintenance.maintenance.overrides.country,
      currency: selectedMaintenance.maintenance.overrides.currency
    });
  }, [maintenanceForm, modalState.modal, modalState.target, selectedMaintenance?.account.id]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = await apiClient.getTeamOrderDashboard();
      setDashboard(next);
      if (!silent || !form.isFieldsTouched()) form.setFieldsValue(next.globalConfig);
    } catch (error) {
      onError(error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [form, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void load(true);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (dashboard?.items ?? []).filter((item) => {
      const matchesQuery = !normalized || [
        item.account.searchText,
        item.account.email,
        item.account.remark,
        item.account.workspaceName,
        item.maintenance.lastError
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized));
      return matchesQuery && matchesFilter(item, filter, now);
    });
  }, [dashboard?.items, filter, now, query]);

  const activeCount = dashboard?.items.filter((item) => item.maintenance.status === 'active').length ?? 0;
  const validCount = dashboard?.items.filter((item) => item.orders.some((order) => (
    presentedTeamOrderStatus(order, now) === 'ready' || presentedTeamOrderStatus(order, now) === 'expiring'
  ))).length ?? 0;
  const attentionCount = dashboard?.items.filter((item) => matchesFilter(item, 'attention', now)).length ?? 0;

  const saveGlobalConfig = async (values: TeamOrderConfig) => {
    setSaving(true);
    try {
      const config = await apiClient.updateTeamOrderGlobalConfig(values);
      setDashboard((current) => current ? { ...current, globalConfig: config } : current);
      message.success('全局订单配置已保存，后续任务会在启动时读取当前配置');
      await load(true);
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  };

  const generateAll = async () => {
    setBatching(true);
    try {
      const result = await apiClient.generateAllTeamOrders();
      message.success(`已加入队列 ${result.queued} 个，跳过 ${result.skipped} 个；将在 10 分钟内分散执行`);
      await load(true);
    } catch (error) {
      onError(error);
    } finally {
      setBatching(false);
    }
  };

  const retryOrder = async (accountId: string, order: MaintainedTeamOrder) => {
    setRetryingOrderId(order.id);
    try {
      await apiClient.retryAccountTeamOrder(accountId, order.id);
      message.success(teamOrderRetryMode(order) === 'expedite' ? '已提前执行下一次重试' : '已创建新的订单任务');
      await load(true);
    } catch (error) {
      onError(error);
    } finally {
      setRetryingOrderId('');
    }
  };

  const openMaintenanceAction = (
    modal: 'edit-maintenance' | 'remove-maintenance',
    accountId: string
  ) => {
    setSearchParams(setTeamOrderPageModalState(searchParams, modal, accountId));
  };

  const closeMaintenanceAction = () => {
    setSearchParams(clearTeamOrderPageModalState(searchParams));
  };

  const saveMaintenanceConfig = async (values: TeamOrderConfigOverrides) => {
    if (!selectedMaintenance) return;
    setEditingMaintenance(true);
    try {
      await apiClient.saveAccountTeamOrderMaintenance(selectedMaintenance.account.id, values);
      message.success('母号订单配置已更新');
      closeMaintenanceAction();
      await load(true);
    } catch (error) {
      onError(error);
    } finally {
      setEditingMaintenance(false);
    }
  };

  const removeMaintenance = async () => {
    if (!selectedMaintenance) return;
    setRemovingMaintenance(true);
    try {
      await apiClient.removeAccountTeamOrderMaintenance(selectedMaintenance.account.id);
      message.success('已移出订单维护池');
      closeMaintenanceAction();
      await load(true);
    } catch (error) {
      onError(error);
    } finally {
      setRemovingMaintenance(false);
    }
  };

  const columns: TableColumnsType<TeamOrderMaintenanceView> = [
    {
      title: '母号 / Workspace',
      key: 'account',
      width: 240,
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <Typography.Link href={`/parents/${item.account.id}?tab=order-maintenance`}>
            {item.account.remark || item.account.email}
          </Typography.Link>
          <Typography.Text type="secondary">{item.account.email}</Typography.Text>
          <Typography.Text type="secondary" ellipsis={{ tooltip: item.account.workspaceName || item.account.accountId }}>
            {item.account.workspaceName || item.account.accountId}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: '维护状态',
      key: 'maintenance',
      width: 132,
      render: (_, item) => item.maintenance.status === 'active'
        ? <Tag color="processing">维护中</Tag>
        : <Tag color="warning">已暂停</Tag>
    },
    {
      title: '当前配置',
      key: 'config',
      width: 185,
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <span>{item.effectiveConfig.promoCode || '无优惠码'}</span>
          <Typography.Text type="secondary">{item.effectiveConfig.country} / {item.effectiveConfig.currency}</Typography.Text>
        </Space>
      )
    },
    {
      title: '最新订单',
      key: 'latest',
      width: 240,
      render: (_, item) => {
        const latest = item.orders[0];
        if (!latest) return <Typography.Text type="secondary">等待首次生成</Typography.Text>;
        const retryMode = teamOrderRetryMode(latest);
        return (
          <Space direction="vertical" size={2}>
            <TeamOrderStatusTag order={latest} now={now} />
            <Typography.Text type="secondary">{formatDateTime(latest.stripeCreatedAt ?? latest.createdAt)}</Typography.Text>
            {latest.error && <Typography.Text type="danger" ellipsis={{ tooltip: latest.error }}>{latest.error}</Typography.Text>}
            {latest.status === 'queued' && latest.retryAt && (
              <Typography.Text type="secondary">自动重试 {formatDateTime(latest.retryAt)}</Typography.Text>
            )}
            {retryMode && (
              <Popconfirm
                title={retryMode === 'expedite' ? '立即执行下一次尝试？' : '重新生成一个订单？'}
                description={retryMode === 'expedite'
                  ? '将跳过等待时间，沿用本条配置快照并消耗一次 TeamCode 额度。'
                  : '将保留失败记录，按当前维护配置创建新任务。'}
                okText={retryMode === 'expedite' ? '立即重试' : '重新生成'}
                cancelText="取消"
                onConfirm={() => void retryOrder(item.account.id, latest)}
              >
                <Button size="small" icon={<RedoOutlined />} loading={retryingOrderId === latest.id}>
                  {retryMode === 'expedite' ? '立即重试' : '重新生成'}
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      }
    },
    {
      title: '支付链接 / 剩余有效期',
      key: 'pay',
      width: 225,
      render: (_, item) => {
        const latest = item.orders.find((order) => order.payUrl && order.expiresAt && order.expiresAt > now);
        if (!latest) return <Typography.Text type="secondary">暂无有效订单</Typography.Text>;
        return (
          <Space direction="vertical" size={2}>
            <Space>
              <Button size="small" type="link" href={latest.payUrl} target="_blank" rel="noreferrer">打开支付页</Button>
              <Typography.Text copyable={{ text: latest.payUrl! }}>复制</Typography.Text>
            </Space>
            <Typography.Text type="secondary">剩余 {teamOrderRemainingText(latest.expiresAt, now)}</Typography.Text>
          </Space>
        );
      }
    },
    {
      title: '下次自动生成',
      key: 'next',
      width: 180,
      render: (_, item) => item.maintenance.status === 'active'
        ? formatDateTime(item.maintenance.nextRunAt)
        : <Typography.Text type="secondary">暂停期间不执行</Typography.Text>
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, item) => {
        const hasRunningOrder = item.orders.some((order) => order.status === 'running');
        const canEdit = item.account.planType === 'self_serve_business_usage_based'
          && !item.account.hasTeamSubscription;
        return (
          <Space size={4} wrap={false}>
            <Tooltip title={canEdit ? '' : '该 Workspace 当前不能修改升级订单配置'}>
              <span>
                <Button
                  size="small"
                  type="link"
                  icon={<EditOutlined />}
                  disabled={!canEdit}
                  onClick={() => openMaintenanceAction('edit-maintenance', item.account.id)}
                >
                  编辑
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={hasRunningOrder ? '存在执行中的订单，完成后才能移出' : ''}>
              <span>
                <Button
                  size="small"
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={hasRunningOrder}
                  onClick={() => openMaintenanceAction('remove-maintenance', item.account.id)}
                >
                  移出
                </Button>
              </span>
            </Tooltip>
          </Space>
        );
      }
    }
  ];

  return (
    <Space direction="vertical" size={16} className="team-orders-page">
      <div className="team-orders-header">
        <div>
          <Typography.Title level={2}>订单状态维护</Typography.Title>
          <Typography.Paragraph type="secondary">
            为已选 Codex Workspace 周期性生成普通两席位 Team 升级订单。页面只跟踪生成和 24 小时有效期，不检查是否付款。
          </Typography.Paragraph>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
          <Popconfirm
            title="立即触发全部生成订单？"
            description="仅为维护中的母号排队，任务会在接下来的 10 分钟内分散执行，不改变各母号的 8 小时自动周期。"
            okText="加入队列"
            cancelText="取消"
            onConfirm={() => void generateAll()}
          >
            <Button type="primary" icon={<ThunderboltOutlined />} loading={batching} disabled={!activeCount || !dashboard?.configured}>
              立即触发全部
            </Button>
          </Popconfirm>
        </Space>
      </div>

      {dashboard && !dashboard.configured && (
        <Alert type="error" showIcon message="TeamCode 未配置" description="请在 Team Manager 运行环境中配置 TeamCode 地址与独立口令。" />
      )}

      <div className="team-order-stat-grid">
        <Card><Statistic title="维护池" value={dashboard?.items.length ?? 0} suffix="个母号" /></Card>
        <Card><Statistic title="自动维护中" value={activeCount} suffix="个" /></Card>
        <Card><Statistic title="有可用订单" value={validCount} suffix="个" /></Card>
        <Card><Statistic title="需要关注" value={attentionCount} suffix="个" /></Card>
      </div>

      <Card title="全局订单配置" extra={<Typography.Text type="secondary">母号空配置会继承这里；任务启动时读取</Typography.Text>}>
        <Form<TeamOrderConfig> form={form} layout="vertical" onFinish={(values) => void saveGlobalConfig(values)}>
          <TeamOrderConfigFields compact />
          <Button type="primary" htmlType="submit" loading={saving}>保存全局配置</Button>
        </Form>
      </Card>

      <Card>
        <div className="team-orders-toolbar">
          <Input.Search
            allowClear
            value={query}
            placeholder="搜索母号、邮箱或 Workspace"
            onChange={(event) => setSearchParams(setSearchValue(searchParams, 'q', event.target.value))}
          />
          <Select<MaintenanceFilter>
            value={filter}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'active', label: '维护中' },
              { value: 'paused', label: '已暂停' },
              { value: 'attention', label: '需要关注' }
            ]}
            onChange={(value) => setSearchParams(setSearchValue(searchParams, 'status', value === 'all' ? '' : value))}
          />
        </div>
        <Table
          className="team-orders-table"
          rowKey={(item) => item.account.id}
          loading={loading}
          columns={columns}
          dataSource={visibleItems}
          pagination={false}
          locale={{ emptyText: <Empty description={query || filter !== 'all' ? '没有匹配的维护记录' : '还没有母号加入订单维护池'} /> }}
          scroll={{ x: 1360 }}
          expandable={{
            expandedRowKeys: expanded,
            onExpandedRowsChange: (keys) => setSearchParams(setSearchValue(searchParams, 'expanded', keys.map(String).join(','))),
            expandedRowRender: (item) => (
              <TeamOrderHistoryTable
                orders={item.orders}
                compact
                retryingOrderId={retryingOrderId}
                onRetry={(order) => void retryOrder(item.account.id, order)}
              />
            ),
            rowExpandable: (item) => item.orders.length > 0
          }}
        />
      </Card>

      <Drawer
        title={selectedMaintenance
          ? `编辑维护配置：${selectedMaintenance.account.remark || selectedMaintenance.account.email}`
          : '编辑维护配置'}
        width={520}
        open={modalState.modal === 'edit-maintenance'}
        onClose={closeMaintenanceAction}
      >
        {selectedMaintenance ? (
          <Form<TeamOrderConfigOverrides>
            form={maintenanceForm}
            layout="vertical"
            onFinish={(values) => void saveMaintenanceConfig(values)}
          >
            <Typography.Paragraph type="secondary">
              字段留空时继承全局配置。保存只影响后续首次执行的任务，不修改已经生成或正在重试的订单快照。
            </Typography.Paragraph>
            <TeamOrderConfigFields inherit={dashboard?.globalConfig} />
            <Space>
              <Button type="primary" htmlType="submit" loading={editingMaintenance}>保存配置</Button>
              <Button onClick={closeMaintenanceAction}>取消</Button>
            </Space>
          </Form>
        ) : (
          <Empty description="维护记录不存在或已被移出" />
        )}
      </Drawer>

      <Modal
        title="移出订单维护池"
        open={modalState.modal === 'remove-maintenance'}
        okText="移出维护池"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={removingMaintenance}
        onOk={() => void removeMaintenance()}
        onCancel={closeMaintenanceAction}
      >
        {selectedMaintenance ? (
          <Space direction="vertical" size={8}>
            <Typography.Text strong>
              {selectedMaintenance.account.remark || selectedMaintenance.account.email}
            </Typography.Text>
            <Typography.Text>
              移出后不再执行周期任务，尚未执行的排队订单会被取消。已有订单历史会保留，重新加入后仍可查看。
            </Typography.Text>
          </Space>
        ) : (
          <Empty description="维护记录不存在或已被移出" />
        )}
      </Modal>
    </Space>
  );
}

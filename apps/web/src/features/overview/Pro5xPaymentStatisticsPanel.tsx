import { ReloadOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Empty,
  Space,
  Table,
  Tag,
  Typography,
  type TableColumnsType
} from 'antd';
import type {
  PaymentBillingObservation,
  PaymentProxyObservation,
  Pro5xPaymentAttemptView,
  Pro5xPaymentDecision,
  Pro5xPaymentStatisticsView,
  Pro5xPaymentTransition
} from '@team-manager/shared';
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../api.js';

const DECISION_LABELS: Record<Pro5xPaymentDecision, string> = {
  succeeded: '成功',
  payment_not_approved: 'PNA',
  card_declined: '硬拒',
  technical_failure: '技术失败',
  interrupted: '已终止',
  waiting_manual: '等待人工',
  pending: '进行中'
};

const DECISION_COLORS: Record<Pro5xPaymentDecision, string | undefined> = {
  succeeded: 'success',
  payment_not_approved: 'warning',
  card_declined: 'error',
  technical_failure: undefined,
  interrupted: 'default',
  waiting_manual: 'processing',
  pending: 'processing'
};

const TRANSITION_LABELS: Array<[Pro5xPaymentTransition, string]> = [
  ['payment_not_approved_to_succeeded', 'PNA → 成功'],
  ['payment_not_approved_to_payment_not_approved', 'PNA → PNA'],
  ['payment_not_approved_to_card_declined', 'PNA → 硬拒'],
  ['card_declined_to_succeeded', '硬拒 → 成功'],
  ['card_declined_to_payment_not_approved', '硬拒 → PNA'],
  ['card_declined_to_card_declined', '硬拒 → 硬拒']
];

export function Pro5xPaymentStatisticsPanel({
  initialStatistics
}: {
  initialStatistics?: Pro5xPaymentStatisticsView;
}) {
  const [statistics, setStatistics] = useState(initialStatistics);
  const [loading, setLoading] = useState(initialStatistics === undefined);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatistics(await apiClient.getPro5xPaymentStatistics());
      setError('');
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialStatistics !== undefined) {
      setStatistics(initialStatistics);
      setError('');
      setLoading(false);
      return;
    }
    void load();
  }, [initialStatistics, load]);

  return (
    <Card
      className="pro5x-statistics-panel"
      loading={loading && !statistics}
      title={(
        <div>
          <Typography.Text strong>Pro 5x 付款统计</Typography.Text>
          <Typography.Text type="secondary" className="pro5x-statistics-subtitle">
            PNA 与硬拒重试转化，以及每次付款提交的原始记录
          </Typography.Text>
        </div>
      )}
      extra={(
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void load()}
        >
          刷新
        </Button>
      )}
    >
      {error && <Alert className="pro5x-statistics-alert" type="error" showIcon message={error} />}
      {!statistics ? (
        !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无付款统计" />
      ) : (
        <Space direction="vertical" size={16} className="pro5x-statistics-content">
          <div className="pro5x-statistics-summary">
            <Tag>任务 {statistics.uniqueOperations}</Tag>
            <Tag>提交 {statistics.totalAttempts}</Tag>
            <Tag>付款判定 {statistics.decisionAttempts}</Tag>
            <Tag color="success">成功 {statistics.succeeded}</Tag>
            <Tag color="warning">PNA {statistics.paymentNotApproved}</Tag>
            <Tag color="error">硬拒 {statistics.cardDeclined}</Tag>
            <Tag>技术失败 {statistics.technicalFailures}</Tag>
            <Tag color="processing">进行中 {statistics.pending + statistics.waitingManual}</Tag>
            {statistics.updatedAt && (
              <Typography.Text type="secondary">
                更新于 {formatTimestamp(statistics.updatedAt)}
              </Typography.Text>
            )}
          </div>

          <div className="pro5x-transition-grid" aria-label="付款重试转化">
            {TRANSITION_LABELS.map(([key, label]) => (
              <div className="pro5x-transition-item" key={key}>
                <Typography.Text type="secondary">{label}</Typography.Text>
                <Typography.Text strong>{statistics.transitions[key]}</Typography.Text>
              </div>
            ))}
          </div>

          <Table<Pro5xPaymentAttemptView>
            aria-label="Pro 5x 付款提交明细"
            columns={attemptColumns}
            dataSource={statistics.recentAttempts}
            rowKey="id"
            size="small"
            scroll={{ x: 1540 }}
            pagination={{
              defaultPageSize: 10,
              pageSizeOptions: [10, 20, 50],
              showSizeChanger: statistics.recentAttempts.length > 10,
              showTotal: (total) => `共 ${total} 次提交`
            }}
            locale={{ emptyText: '暂无付款提交记录' }}
          />
        </Space>
      )}
    </Card>
  );
}

const attemptColumns: TableColumnsType<Pro5xPaymentAttemptView> = [
  {
    title: '时间',
    dataIndex: 'startedAt',
    width: 168,
    fixed: 'left',
    render: (startedAt: number, attempt) => (
      <Space direction="vertical" size={0}>
        <Typography.Text>{formatTimestamp(startedAt)}</Typography.Text>
        <Typography.Text type="secondary">第 {attempt.number} 次提交</Typography.Text>
      </Space>
    )
  },
  {
    title: '账号 / 卡片',
    dataIndex: 'accountId',
    width: 238,
    fixed: 'left',
    render: (accountId: string, attempt) => (
      <Space direction="vertical" size={0} className="pro5x-attempt-stack">
        <Typography.Text copyable={{ text: accountId }}>{accountId}</Typography.Text>
        <Typography.Text type="secondary">
          卡 {attempt.cardLast4} · 指纹 {attempt.cardFingerprintSuffix}
        </Typography.Text>
      </Space>
    )
  },
  {
    title: '结果',
    dataIndex: 'decision',
    width: 116,
    render: (decision: Pro5xPaymentDecision, attempt) => (
      <Space direction="vertical" size={2}>
        <Tag color={DECISION_COLORS[decision]}>{DECISION_LABELS[decision]}</Tag>
        {attempt.cardHardFailure && <Typography.Text type="danger">计入硬拒</Typography.Text>}
      </Space>
    )
  },
  {
    title: '代理出口',
    dataIndex: 'proxyObservation',
    width: 250,
    render: (proxy?: PaymentProxyObservation) => <ProxyObservationView proxy={proxy} />
  },
  {
    title: 'Checkout 订单',
    dataIndex: 'checkoutSessionId',
    width: 250,
    render: (sessionId: string | undefined, attempt) => (
      <Space direction="vertical" size={2} className="pro5x-attempt-stack">
        {sessionId
          ? <Typography.Text copyable={{ text: sessionId }}>{sessionId}</Typography.Text>
          : <Typography.Text type="secondary">未记录 Session</Typography.Text>}
        {attempt.number === 1
          ? <Tag>首个订单</Tag>
          : attempt.checkoutRecreated === true
            ? <Tag color="success">已重新创建订单</Tag>
            : attempt.checkoutRecreated === false
              ? <Tag color="error">沿用原订单</Tag>
              : <Tag>无法确认是否新建</Tag>}
      </Space>
    )
  },
  {
    title: '账单姓名 / 地址',
    dataIndex: 'billingObservation',
    width: 310,
    render: (billing?: PaymentBillingObservation) => <BillingObservationView billing={billing} />
  },
  {
    title: '间隔 / 错误',
    key: 'interval-error',
    width: 210,
    render: (_, attempt) => (
      <Space direction="vertical" size={0} className="pro5x-attempt-stack">
        <Typography.Text>
          {attempt.intervalFromPreviousMs === undefined
            ? '首次提交'
            : `距上次 ${formatDuration(attempt.intervalFromPreviousMs)}`}
        </Typography.Text>
        {attempt.errorCode && (
          <Typography.Text type="secondary" copyable={{ text: attempt.errorCode }}>
            {attempt.errorCode}
          </Typography.Text>
        )}
        {attempt.errorMessage && (
          <Typography.Text type="danger">{attempt.errorMessage}</Typography.Text>
        )}
      </Space>
    )
  }
];

function ProxyObservationView({ proxy }: { proxy?: PaymentProxyObservation }) {
  if (!proxy) return <Typography.Text type="secondary">未记录</Typography.Text>;
  return (
    <Space direction="vertical" size={0} className="pro5x-attempt-stack">
      {proxy.ip && <Typography.Text copyable={{ text: proxy.ip }}>IP {proxy.ip}</Typography.Text>}
      {proxy.sid && <Typography.Text copyable={{ text: proxy.sid }}>SID {proxy.sid}</Typography.Text>}
      <Typography.Text type="secondary">
        {[proxy.country, proxy.asn, proxy.state, proxy.city].filter(Boolean).join(' · ') || '地区未知'}
      </Typography.Text>
      {proxy.observationError && <Typography.Text type="danger">{proxy.observationError}</Typography.Text>}
    </Space>
  );
}

function BillingObservationView({ billing }: { billing?: PaymentBillingObservation }) {
  if (!billing) return <Typography.Text type="secondary">未记录</Typography.Text>;
  const address = billing.address;
  return (
    <Space direction="vertical" size={0} className="pro5x-attempt-stack">
      <Typography.Text copyable={{ text: billing.holderName }}>{billing.holderName}</Typography.Text>
      {billing.email && <Typography.Text>{billing.email}</Typography.Text>}
      <Typography.Text type="secondary">
        {[address.line1, address.city, address.state, address.postalCode, address.country]
          .filter(Boolean)
          .join(', ')}
      </Typography.Text>
      {address.phone && <Typography.Text type="secondary">{address.phone}</Typography.Text>}
    </Space>
  );
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分`;
}

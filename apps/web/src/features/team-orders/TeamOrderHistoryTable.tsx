import type { MaintainedTeamOrder } from '@team-manager/shared';
import { Button, Popconfirm, Space, Table, Typography, type TableColumnsType } from 'antd';
import { ExportOutlined, RedoOutlined } from '@ant-design/icons';
import { formatDateTime, shortText } from '../../components/format.js';
import { teamOrderRemainingText, teamOrderRetryMode, teamOrderSourceLabel } from './teamOrderPresentation.js';
import { TeamOrderStatusTag } from './TeamOrderStatusTag.js';

export function TeamOrderHistoryTable({
  orders,
  compact = false,
  retryingOrderId,
  onRetry
}: {
  orders: MaintainedTeamOrder[];
  compact?: boolean;
  retryingOrderId?: string;
  onRetry?: (order: MaintainedTeamOrder) => void;
}) {
  const columns: TableColumnsType<MaintainedTeamOrder> = [
    {
      title: '状态',
      key: 'status',
      width: 105,
      render: (_, order) => <TeamOrderStatusTag order={order} />
    },
    {
      title: '触发方式',
      dataIndex: 'source',
      width: 100,
      render: teamOrderSourceLabel
    },
    {
      title: '生成时间',
      key: 'created',
      width: 176,
      render: (_, order) => formatDateTime(order.stripeCreatedAt ?? order.createdAt)
    },
    {
      title: '有效期',
      key: 'expires',
      width: 205,
      render: (_, order) => order.expiresAt
        ? <Space direction="vertical" size={0}>
            <span>{teamOrderRemainingText(order.expiresAt)}</span>
            <Typography.Text type="secondary">{formatDateTime(order.expiresAt)}</Typography.Text>
          </Space>
        : '—'
    },
    {
      title: '配置快照',
      key: 'config',
      width: 190,
      render: (_, order) => `${order.config.promoCode || '无优惠码'} · ${order.config.country}/${order.config.currency}`
    },
    {
      title: '结果',
      key: 'result',
      render: (_, order) => {
        if (order.payUrl) return <Space wrap>
            <Button size="small" type="link" href={order.payUrl} target="_blank" rel="noreferrer" icon={<ExportOutlined />}>
              打开支付页
            </Button>
            <Typography.Text copyable={{ text: order.payUrl }}>复制链接</Typography.Text>
          </Space>;
        const retryMode = teamOrderRetryMode(order);
        return (
          <Space direction="vertical" size={4}>
            <Typography.Text
              type={order.error ? 'danger' : 'secondary'}
              ellipsis={order.error ? { tooltip: order.error } : undefined}
            >
              {order.error ? shortText(order.error, 160) : '等待生成'}
            </Typography.Text>
            {order.status === 'queued' && order.retryAt && (
              <Typography.Text type="secondary">自动重试：{formatDateTime(order.retryAt)}</Typography.Text>
            )}
            {retryMode && onRetry && (
              <Popconfirm
                title={retryMode === 'expedite' ? '立即执行下一次尝试？' : '重新生成一个订单？'}
                description={retryMode === 'expedite'
                  ? '将跳过当前等待时间，沿用本条配置快照并消耗一次 TeamCode 额度。'
                  : '将保留本条失败记录，按当前维护配置创建新任务。'}
                okText={retryMode === 'expedite' ? '立即重试' : '重新生成'}
                cancelText="取消"
                onConfirm={() => onRetry(order)}
              >
                <Button
                  size="small"
                  icon={<RedoOutlined />}
                  loading={retryingOrderId === order.id}
                >
                  {retryMode === 'expedite' ? '立即重试' : '重新生成'}
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      }
    }
  ];

  return (
    <Table
      className="team-order-history-table"
      rowKey="id"
      size={compact ? 'small' : 'middle'}
      columns={columns}
      dataSource={orders}
      pagination={false}
      locale={{ emptyText: '还没有订单记录' }}
      scroll={{ x: 980 }}
    />
  );
}

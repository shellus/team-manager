import { useEffect, useState } from 'react';
import type { AccountBillingSnapshot, AccountView } from '@team-manager/shared';
import { DownloadOutlined, ExportOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Empty, Space, Table, Tag, Typography } from 'antd';
import { apiClient } from '../../api.js';
import { downloadTextFile } from '../../components/fileDownload.js';
import { formatDateTime, formatRelativeTime } from '../../components/format.js';
import { buildBillingSnapshotDownload } from './billingDownload.js';
import {
  buildBillingSummary,
  formatBillingAmount,
  type BillingInvoiceSummary,
  type BillingPaymentMethodSummary,
  type BillingSeatCount
} from './billingSummary.js';

function billingManageUrl(workspaceAccountId: string): string {
  return `https://chatgpt.com/account/manage?account_id=${encodeURIComponent(workspaceAccountId)}`;
}

function statusTag(status: string, paid?: boolean) {
  if (paid || status === 'paid') return <Tag color="success">paid</Tag>;
  if (status === 'open') return <Tag color="processing">open</Tag>;
  if (status === 'void' || status === 'uncollectible') return <Tag color="error">{status}</Tag>;
  return <Tag>{status || '暂无'}</Tag>;
}

export function ParentBillingPanel({ account }: { account: AccountView }) {
  const [snapshot, setSnapshot] = useState<AccountBillingSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    apiClient
      .getBillingSnapshot(account.id)
      .then((result) => {
        if (!cancelled) setSnapshot(result);
      })
      .catch((loadError) => {
        if (!cancelled) setError((loadError as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account.id]);

  const workspaceAccountId = snapshot?.workspaceAccountId ?? account.accountId;
  const summary = snapshot ? buildBillingSummary(snapshot.raw) : null;

  const refresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      setSnapshot(await apiClient.refreshBillingSnapshot(account.id));
    } catch (refreshError) {
      setError((refreshError as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Space direction="vertical" size={16} className="panel-stack">
      {error && <Alert type="error" showIcon message={error} />}
      <Card
        title="账单快照"
        loading={loading}
        extra={
          <Space wrap>
            <Button
              icon={<ExportOutlined />}
              href={billingManageUrl(workspaceAccountId)}
              target="_blank"
              rel="noreferrer"
            >
              账单管理页
            </Button>
            {snapshot && (
              <Button
                icon={<DownloadOutlined />}
                onClick={() => downloadTextFile(buildBillingSnapshotDownload(account, snapshot))}
              >
                下载 JSON
              </Button>
            )}
            <Button type="primary" icon={<ReloadOutlined />} loading={refreshing} onClick={() => void refresh()}>
              刷新账单
            </Button>
          </Space>
        }
      >
        {snapshot ? (
          <Space direction="vertical" size={16} className="panel-stack">
            <Descriptions column={{ xs: 1, md: 2 }} bordered size="small">
              <Descriptions.Item label="母号">{account.email}</Descriptions.Item>
              <Descriptions.Item label="workspace">
                <Typography.Text copyable={{ text: snapshot.workspaceAccountId }}>
                  {snapshot.workspaceAccountId}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="保存时间">{formatDateTime(snapshot.refreshedAt)}</Descriptions.Item>
              <Descriptions.Item label="距现在">{formatRelativeTime(snapshot.refreshedAt)}</Descriptions.Item>
            </Descriptions>
            <Typography.Title level={5}>席位计数</Typography.Title>
            <Table<BillingSeatCount>
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={summary?.seatCounts ?? []}
              locale={{ emptyText: '暂无席位计数' }}
              columns={[
                { title: '席位类型', dataIndex: 'label' },
                { title: '原始类型', dataIndex: 'key' },
                { title: '数量', dataIndex: 'count', align: 'right' }
              ]}
            />
            <Typography.Title level={5}>最近发票</Typography.Title>
            <Table<BillingInvoiceSummary>
              rowKey={(invoice) => invoice.id || invoice.number}
              size="small"
              pagination={false}
              dataSource={summary?.invoices ?? []}
              locale={{ emptyText: '暂无发票' }}
              columns={[
                {
                  title: '发票',
                  render: (_, invoice) => (
                    <Space direction="vertical" size={2}>
                      <Typography.Text strong>{invoice.number || invoice.id || '暂无'}</Typography.Text>
                      <Typography.Text type="secondary">{formatDateTime(invoice.createdAt)}</Typography.Text>
                    </Space>
                  )
                },
                {
                  title: '状态',
                  render: (_, invoice) => statusTag(invoice.status, invoice.paid)
                },
                {
                  title: '金额',
                  render: (_, invoice) => (
                    <Space direction="vertical" size={2}>
                      <Typography.Text>{formatBillingAmount(invoice.total, invoice.currency)}</Typography.Text>
                      <Typography.Text type="secondary">
                        小计 {formatBillingAmount(invoice.subtotal, invoice.currency)} / 税 {formatBillingAmount(invoice.tax, invoice.currency)}
                      </Typography.Text>
                    </Space>
                  )
                },
                {
                  title: '项目',
                  render: (_, invoice) => (
                    <Space direction="vertical" size={2}>
                      <Typography.Text>{invoice.lineDescription || '暂无'}</Typography.Text>
                      <Typography.Text type="secondary">
                        数量 {invoice.lineQuantity ?? '暂无'} · 单价 {formatBillingAmount(invoice.lineUnitAmount, invoice.currency)}
                      </Typography.Text>
                    </Space>
                  )
                },
                {
                  title: '账期',
                  render: (_, invoice) => `${formatDateTime(invoice.periodStart)} - ${formatDateTime(invoice.periodEnd)}`
                },
                {
                  title: '链接',
                  render: (_, invoice) => (
                    <Space>
                      {invoice.hostedInvoiceUrl && (
                        <Typography.Link href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                          在线
                        </Typography.Link>
                      )}
                      {invoice.invoicePdfUrl && (
                        <Typography.Link href={invoice.invoicePdfUrl} target="_blank" rel="noreferrer">
                          PDF
                        </Typography.Link>
                      )}
                    </Space>
                  )
                }
              ]}
            />
            <Typography.Title level={5}>付款方式</Typography.Title>
            <Table<BillingPaymentMethodSummary>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={summary?.paymentMethods ?? []}
              locale={{ emptyText: '暂无付款方式' }}
              columns={[
                {
                  title: '类型',
                  render: (_, method) => (
                    <Space>
                      <Typography.Text>{method.type || '暂无'}</Typography.Text>
                      {method.isDefault && <Tag color="processing">默认</Tag>}
                    </Space>
                  )
                },
                { title: '品牌', dataIndex: 'brand' },
                { title: '尾号', dataIndex: 'last4' },
                {
                  title: '有效期',
                  render: (_, method) =>
                    method.expMonth && method.expYear ? `${String(method.expMonth).padStart(2, '0')}/${method.expYear}` : '暂无'
                }
              ]}
            />
            <Typography.Title level={5}>账单主体</Typography.Title>
            <Descriptions column={{ xs: 1, md: 2 }} bordered size="small">
              <Descriptions.Item label="名称">{summary?.billingInfo.name || '暂无'}</Descriptions.Item>
              <Descriptions.Item label="税号">{summary?.billingInfo.taxId || '暂无'}</Descriptions.Item>
              <Descriptions.Item label="地址" span={2}>
                {summary?.billingInfo.address || '暂无'}
              </Descriptions.Item>
            </Descriptions>
          </Space>
        ) : (
          <Empty description="暂无账单快照">
            <Button type="primary" icon={<ReloadOutlined />} loading={refreshing} onClick={() => void refresh()}>
              刷新账单
            </Button>
          </Empty>
        )}
      </Card>
    </Space>
  );
}

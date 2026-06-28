import { useEffect, useMemo, useState } from 'react';
import type { AccountSeatSlotStatus, PublicSeatSlotView, SeatSlotSwapState, SeatSlotSwapStep } from '@team-manager/shared';
import { Alert, Button, Collapse, Descriptions, Form, Input, Result, Space, Spin, Steps, Tag, Typography } from 'antd';
import { SwapOutlined, ReloadOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { apiClient } from '../../api.js';

const STATUS_LABEL: Record<AccountSeatSlotStatus, string> = {
  empty: '空位',
  invited: '邀请中',
  member: '已绑定',
  unknown: '待确认'
};

const STATUS_COLOR: Record<AccountSeatSlotStatus, string> = {
  empty: 'default',
  invited: 'processing',
  member: 'success',
  unknown: 'warning'
};

const SWAP_STATUS_LABEL: Record<SeatSlotSwapState['status'], string> = {
  running: '进行中',
  succeeded: '成功',
  failed: '失败'
};

const SWAP_STATUS_COLOR: Record<SeatSlotSwapState['status'], string> = {
  running: 'processing',
  succeeded: 'success',
  failed: 'error'
};

type StepItem = ReturnType<typeof buildStepItems>[number];

export interface SeatSwapHistoryItem {
  id: string;
  title: string;
  statusText: string;
  statusColor: string;
  meta: string;
  steps: StepItem[];
}

export function PublicSeatPage() {
  const { seatKey = '' } = useParams();
  const [slot, setSlot] = useState<PublicSeatSlotView | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form] = Form.useForm<{ email: string }>();

  const steps = useMemo(() => buildStepItems(slot?.swap?.steps), [slot?.swap?.steps]);
  const historyItems = useMemo(
    () => buildSwapHistoryItems(slot?.swapHistory, slot?.swap),
    [slot?.swapHistory, slot?.swap]
  );

  const load = async () => {
    if (!seatKey) return;
    setLoading(true);
    setError('');
    try {
      setSlot(await apiClient.getPublicSeatSlot(seatKey));
    } catch (loadError) {
      setError((loadError as Error).message);
      setSlot(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [seatKey]);

  const submit = async ({ email }: { email: string }) => {
    setSubmitting(true);
    setError('');
    try {
      setSlot({
        ...(slot ?? { seatKey, expiresOn: '', status: 'unknown' as const }),
        swap: {
          id: 'local-submitting',
          status: 'running',
          ...(slot?.email ? { fromEmail: slot.email } : {}),
          toEmail: email.trim(),
          startedAt: Date.now(),
          updatedAt: Date.now(),
          steps: [{ key: 'refreshing_parent', label: '正在提交换号请求', status: 'running', at: Date.now() }]
        }
      });
      const updated = await apiClient.swapPublicSeatSlotEmail(seatKey, email);
      setSlot(updated);
      form.resetFields();
    } catch (swapError) {
      setError((swapError as Error).message);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !slot) {
    return (
      <div className="public-seat-page">
        <Spin />
      </div>
    );
  }

  if (!slot) {
    return (
      <div className="public-seat-page">
        <Result
          status="404"
          title="席位不可用"
          subTitle={error || '未找到对应席位'}
          extra={<Button icon={<ReloadOutlined />} onClick={() => void load()}>重新加载</Button>}
        />
      </div>
    );
  }

  return (
    <div className="public-seat-page">
      <main className="public-seat-panel">
        <Space direction="vertical" size={18} className="panel-stack">
          <div className="public-seat-header">
            <div>
              <Typography.Title level={1}>ChatGPT Team 席位</Typography.Title>
              <Typography.Text type="secondary">席位 Key：{slot.seatKey}</Typography.Text>
            </div>
            <Tag color={STATUS_COLOR[slot.status]}>{STATUS_LABEL[slot.status]}</Tag>
          </div>

          {error && <Alert type="error" showIcon message={error} />}

          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="备注">{slot.remark || '未填写'}</Descriptions.Item>
            <Descriptions.Item label="到期时间">{slot.expiresOn}</Descriptions.Item>
            <Descriptions.Item label="价格">{slot.price || '未填写'}</Descriptions.Item>
            <Descriptions.Item label="当前邮箱">{slot.email || '未绑定'}</Descriptions.Item>
          </Descriptions>

          <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
            <Form.Item
              name="email"
              label="新邮箱"
              rules={[
                { required: true, message: '请输入新邮箱' },
                { type: 'email', message: '邮箱格式不正确' }
              ]}
            >
              <Input autoComplete="email" placeholder="name@example.com" />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<SwapOutlined />} loading={submitting}>
              换号
            </Button>
          </Form>

          {steps.length > 0 && (
            <section className="public-seat-section">
              <Typography.Title level={2}>最近一次换号进度</Typography.Title>
              <Steps direction="vertical" size="small" items={steps} />
            </section>
          )}

          <section className="public-seat-section">
            <Typography.Title level={2}>换号历史</Typography.Title>
            {historyItems.length > 0 ? (
              <Collapse
                bordered={false}
                items={historyItems.map((item) => ({
                  key: item.id,
                  label: (
                    <div className="seat-history-label">
                      <div>
                        <Typography.Text strong>{item.title}</Typography.Text>
                        <Typography.Text type="secondary">{item.meta}</Typography.Text>
                      </div>
                      <Tag color={item.statusColor}>{item.statusText}</Tag>
                    </div>
                  ),
                  children: <Steps direction="vertical" size="small" items={item.steps} />
                }))}
              />
            ) : (
              <Typography.Text type="secondary">暂无换号记录</Typography.Text>
            )}
          </section>
        </Space>
      </main>
    </div>
  );
}

export function buildSwapHistoryItems(
  history: SeatSlotSwapState[] | undefined,
  activeSwap?: SeatSlotSwapState
): SeatSwapHistoryItem[] {
  const swapsById = new Map<string, SeatSlotSwapState>();
  for (const swap of history ?? []) {
    swapsById.set(swap.id, swap);
  }
  if (activeSwap) {
    swapsById.set(activeSwap.id, activeSwap);
  }

  return Array.from(swapsById.values())
    .sort((left, right) => right.startedAt - left.startedAt)
    .map((swap) => ({
      id: swap.id,
      title: `${swap.fromEmail ?? '未绑定'} -> ${swap.toEmail}`,
      statusText: SWAP_STATUS_LABEL[swap.status],
      statusColor: SWAP_STATUS_COLOR[swap.status],
      meta: formatSwapTime(swap.startedAt),
      steps: buildStepItems(swap.steps)
    }));
}

function buildStepItems(steps: SeatSlotSwapStep[] | undefined) {
  return (steps ?? []).map((step) => ({
    title: step.label,
    description: step.message,
    status: step.status === 'done' || step.status === 'skipped'
      ? 'finish' as const
      : step.status === 'failed'
        ? 'error' as const
        : step.status === 'running'
          ? 'process' as const
          : 'wait' as const
  }));
}

function formatSwapTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

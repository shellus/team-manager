import { useEffect, useMemo, useState } from 'react';
import type { PublicSeatSlotView, SeatSlotSwapState, SeatSlotSwapStep } from '@team-manager/shared';
import { Alert, Button, Collapse, Descriptions, Form, Input, Result, Space, Spin, Steps, Tag, Typography } from 'antd';
import { SwapOutlined, ReloadOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { apiClient } from '../../api.js';
import { SeatSlotStatusTag } from '../../components/StatusTag.js';
import { useActionBusy } from '../../components/useActionBusy.js';

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

export function nextPublicSeatLoadError(currentError: string, loadError: unknown, preserveError: boolean): string {
  if (loadError) return (loadError as Error).message;
  return preserveError ? currentError : '';
}

export function PublicSeatPage() {
  const { seatKey = '' } = useParams();
  const [slot, setSlot] = useState<PublicSeatSlotView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form] = Form.useForm<{ email: string }>();
  const actionBusy = useActionBusy();
  const submitting = actionBusy.isBusy('public-seat-swap');
  const blocksStandardMemberSwap = slot?.seat === 'default' && slot.relationStatus === 'member';
  const expired = slot?.expirationStatus === 'expired';

  const steps = useMemo(() => buildStepItems(slot?.swap?.steps), [slot?.swap?.steps]);
  const historyItems = useMemo(
    () => buildSwapHistoryItems(slot?.swapHistory, slot?.swap),
    [slot?.swapHistory, slot?.swap]
  );

  const load = async (options: { preserveError?: boolean } = {}) => {
    if (!seatKey) return;
    setLoading(true);
    if (!options.preserveError) setError('');
    try {
      setSlot(await apiClient.getPublicSeatSlot(seatKey));
    } catch (loadError) {
      setError((current) => nextPublicSeatLoadError(current, loadError, Boolean(options.preserveError)));
      setSlot(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [seatKey]);

  const submit = async ({ email }: { email: string }) => {
    setError('');
    try {
      await actionBusy.run('public-seat-swap', async () => {
        setSlot({
          ...(slot ?? { seatKey, expiresOn: '', relationStatus: 'unlinked' as const, expirationStatus: 'not_set' as const }),
          swap: {
            id: 'local-submitting',
            status: 'running',
            ...(slot?.email ? { fromEmail: slot.email } : {}),
            toEmail: email.trim(),
            startedAt: Date.now(),
            updatedAt: Date.now(),
            steps: [{ key: 'refreshing_workspace', label: '正在提交换号请求', status: 'running', at: Date.now() }]
          }
        });
        const updated = await apiClient.swapPublicSeatSlotEmail(seatKey, email);
        setSlot(updated);
        form.resetFields();
      });
    } catch (swapError) {
      setError((swapError as Error).message);
      await load({ preserveError: true });
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
              <Typography.Title level={1}>Team 客户席位</Typography.Title>
              <Typography.Text type="secondary">席位 Key：{slot.seatKey}</Typography.Text>
            </div>
            <SeatSlotStatusTag status={slot.relationStatus} memberLabel="已绑定" />
          </div>

          {error && <Alert type="error" showIcon message={error} />}
          {expired && <Alert type="error" showIcon message="客户席位已到期" description="到期资料保留用于查询，但不能继续认领或换号。" />}
          {slot.seat === 'default' && (
            <Alert
              type="warning"
              showIcon
              message={blocksStandardMemberSwap ? '该席位不能自动换号' : '标准 ChatGPT 席位存在计费风险'}
              description={blocksStandardMemberSwap
                ? '移除已接受成员后，原席位可能继续临时计费，新成员也可能形成独立付费席位。请联系管理员核对 Billing 后人工处理。'
                : '邀请新成员前应由管理员确认工作区 Billing；上游可能把新成员计为独立付费席位。'}
            />
          )}

          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="备注">{slot.remark || '未填写'}</Descriptions.Item>
            <Descriptions.Item label="到期时间">{slot.expiresOn}</Descriptions.Item>
            <Descriptions.Item label="价格">{slot.price || '未填写'}</Descriptions.Item>
            <Descriptions.Item label="席位类型">{slot.seat === 'usage_based' ? 'Codex' : 'ChatGPT'}</Descriptions.Item>
            <Descriptions.Item label="当前邮箱">{slot.email || '未绑定'}</Descriptions.Item>
          </Descriptions>

          <Form
            form={form}
            layout="vertical"
            disabled={submitting || blocksStandardMemberSwap || expired}
            onFinish={(values) => void submit(values)}
          >
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

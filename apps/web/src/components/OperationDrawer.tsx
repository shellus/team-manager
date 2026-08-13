import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Form, Modal, Progress, Space, Table, Tag, Typography } from 'antd';
import type { AccountManagerOperationView, OperationDetailView } from '@team-manager/shared';
import { unifiedApi } from '../unifiedApi.js';
import { JsonViewer, LoadBoundary, formatTime } from './ProductPrimitives.js';
import { PaymentCardFields } from './PaymentCardFields.js';

export function OperationDrawer({ operation, open, onClose, onChanged }: { operation?: AccountManagerOperationView; open: boolean; onClose: () => void; onChanged?: () => void }) {
  const [detail, setDetail] = useState<OperationDetailView>(); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(''); const [cardOpen, setCardOpen] = useState(false);
  const load = async () => { if (!operation) return; setLoading(true); setError(''); try { setDetail(await unifiedApi.operation(operation.id)); } catch (e) { setError((e as Error).message); setDetail(undefined); } finally { setLoading(false); } };
  useEffect(() => { if (open) void load(); }, [open, operation?.id]);
  const run = async (key: string, action: () => Promise<unknown>) => { setBusy(key); setError(''); try { await action(); await load(); onChanged?.(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } };
  const value = detail ?? operation;
  return <><Drawer title="操作详情与恢复" open={open} onClose={onClose} width={720} destroyOnClose extra={<Button onClick={() => void load()}>刷新状态</Button>}>
    <LoadBoundary loading={loading && !value} error={!value ? error : undefined} onRetry={load}>
      {error && value && <Alert type="error" showIcon message={error} closable onClose={() => setError('')} />}
      {value && <Space direction="vertical" size={16} className="panel-stack">
        <Descriptions bordered size="small" column={2} items={[{ key: 'id', label: '操作 ID', children: value.id },{ key: 'type', label: '类型', children: value.type },{ key: 'status', label: '状态', children: <Tag>{value.status}</Tag> },{ key: 'phase', label: '阶段', children: value.phase },{ key: 'created', label: '创建', children: formatTime(value.createdAt) },{ key: 'updated', label: '更新', children: formatTime(value.updatedAt) }]} />
        <Progress percent={Math.max(0, Math.min(100, value.progress ?? 0))} status={value.status === 'failed' ? 'exception' : value.status === 'succeeded' ? 'success' : 'active'} />
        {(value.message || value.errorMessage) && <Alert type={value.errorMessage ? 'error' : 'info'} showIcon message={value.errorMessage ?? value.message} description={value.errorCode} />}
        <Space wrap>
          <Button loading={busy === 'retry'} onClick={() => run('retry', () => unifiedApi.controlOperation(value.id, 'retry'))}>重试当前步骤</Button>
          <Button loading={busy === 'proxy'} onClick={() => run('proxy', () => unifiedApi.controlOperation(value.id, 'rotate-ip'))}>轮换代理 IP</Button>
          <Button loading={busy === 'terminate'} danger onClick={() => run('terminate', () => unifiedApi.controlOperation(value.id, 'terminate'))}>终止操作</Button>
          <Button onClick={() => setCardOpen(true)}>补充支付卡</Button>
          <Button loading={busy === 'delete'} danger onClick={() => Modal.confirm({ title: '清理操作记录？', content: '只清理操作记录，不回滚已经发生的上游行为。', onOk: () => run('delete', () => unifiedApi.deleteOperation(value.id)).then(onClose) })}>清理记录</Button>
        </Space>
        {detail?.events && <Table rowKey="id" pagination={false} dataSource={detail.events} scroll={{ x: 700 }} columns={[{ title: '时间', dataIndex: 'occurredAt', render: formatTime },{ title: '阶段', dataIndex: 'phase' },{ title: '状态', dataIndex: 'status' },{ title: '原始事件', dataIndex: 'payload', render: (payload) => <JsonViewer title="查看" value={payload}/> }]} />}
        <JsonViewer title="完整请求、响应、支付与结果" value={{ requestSummary: value.requestSummary, result: value.result, payment: detail?.payment, effectiveAt: detail?.effectiveAt, control: value.control }} />
      </Space>}
    </LoadBoundary>
  </Drawer><Modal title="补充支付卡" open={cardOpen} onCancel={() => setCardOpen(false)} footer={null} destroyOnClose><Alert type="info" showIcon message="卡号和 CVC 直接提交给 GAM，不写入 Team Manager 数据库。"/><Form layout="vertical" onFinish={(card) => run('card', () => unifiedApi.supplyOperationCard(value!.id, { card })).then(() => setCardOpen(false))}><PaymentCardFields/><Button type="primary" htmlType="submit" loading={busy === 'card'}>提交支付卡</Button></Form></Modal></>;
}

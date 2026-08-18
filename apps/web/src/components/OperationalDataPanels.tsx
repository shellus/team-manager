import { CheckCircleOutlined, DeleteOutlined } from '@ant-design/icons';
import { Button, Descriptions, Empty, Space, Table, Tag, Typography } from 'antd';
import type { AccountActivityView, BillingDetailView, BillingInvoiceView, SubscriptionDetailView } from '@team-manager/shared';
import { formatPaymentCardLast4, formatTime } from './ProductPrimitives.js';
import { useUrlPagination } from './urlPagination.js';

const planLabels: Record<string, string> = { free:'Free',go:'Go',plus:'Plus',pro_5x:'Pro 5x',pro_20x:'Pro 20x',business:'Business',business_usage_based:'Business 0.52',unknown:'未知' };
const statusLabels: Record<string,string> = { active:'生效中',paid:'已支付',open:'待支付',draft:'草稿',void:'已作废',uncollectible:'无法收款',delinquent:'欠费',unknown:'未知' };

export function SubscriptionSummary({ value }: { value?: SubscriptionDetailView }) {
  if (!value) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无订阅快照" />;
  return <Descriptions bordered size="small" column={{xs:1,sm:2}} items={[
    {key:'plan',label:'套餐',children:<Tag color="blue">{planLabels[value.plan]??value.plan}</Tag>},
    {key:'status',label:'状态',children:statusLabels[value.status]??value.status},
    {key:'renew',label:value.willRenew===false?'到期时间':'下次续费',children:formatTime(value.endsAt)},
    {key:'auto',label:'自动续费',children:value.willRenew===undefined?'未知':value.willRenew?'开启':'已关闭'},
    {key:'effective',label:'生效时间',children:formatTime(value.effectiveAt)},
    {key:'observed',label:'快照时间',children:formatTime(value.observedAt)},
  ]}/>;
}

type PaymentMethodAction = 'default' | 'remove';

export function paymentMethodActionKey(action: PaymentMethodAction, paymentMethodId: string) {
  return `payment-method:${action}:${paymentMethodId}`;
}

export function BillingSummary({ value, paymentMethodActions }: {
  value?: BillingDetailView;
  paymentMethodActions?: {
    busy: string;
    disabled?: boolean;
    onSetDefault: (paymentMethodId: string) => Promise<unknown>;
    onRemove: (paymentMethodId: string) => Promise<unknown>;
  };
}) {
  if (!value) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无账单快照" />;
  const actionDisabled = paymentMethodActions?.disabled || Boolean(paymentMethodActions?.busy);
  return <Space direction="vertical" size={16} className="panel-stack">
    <Typography.Text type="secondary">账单快照：{formatTime(value.observedAt)}</Typography.Text>
    <Typography.Title level={5}>下期预计账单</Typography.Title>
    <InvoiceTable invoices={value.upcomingInvoice?[value.upcomingInvoice]:[]} empty="暂无下期预计账单" upcoming />
    <Typography.Title level={5}>最近发票</Typography.Title>
    <InvoiceTable invoices={value.invoices} empty="暂无发票" />
    <Typography.Title level={5}>支付方式</Typography.Title>
    <Table rowKey="id" size="small" pagination={false} dataSource={value.paymentMethods} locale={{emptyText:'暂无支付方式'}} scroll={{x:paymentMethodActions?820:undefined}} columns={[
      {title:'类型',render:(_,row)=><Space>{row.type??'银行卡'}{row.isDefault&&<Tag color="blue">默认</Tag>}</Space>},
      {title:'品牌',dataIndex:'brand',render:(v)=>v??'—'},
      {title:'尾号',dataIndex:'last4',render:(v)=>formatPaymentCardLast4(v)??'—'},
      {title:'有效期',render:(_,row)=>row.expMonth&&row.expYear?`${String(row.expMonth).padStart(2,'0')}/${row.expYear}`:'—'},
      {title:'标识',dataIndex:'id',render:(id:string)=><Typography.Text code copyable={{text:id}}>{id.slice(-8)}</Typography.Text>},
      ...(paymentMethodActions ? [{
        title:'操作',
        key:'actions',
        width:220,
        render:(_: unknown, row: BillingDetailView['paymentMethods'][number]) => <Space size={4}>
          {!row.isDefault && <Button
            type="link"
            size="small"
            icon={<CheckCircleOutlined />}
            loading={paymentMethodActions.busy === paymentMethodActionKey('default', row.id)}
            disabled={actionDisabled}
            onClick={() => void paymentMethodActions.onSetDefault(row.id)}
          >设为默认</Button>}
          <Button
            danger
            type="link"
            size="small"
            icon={<DeleteOutlined />}
            loading={paymentMethodActions.busy === paymentMethodActionKey('remove', row.id)}
            disabled={actionDisabled}
            onClick={() => void paymentMethodActions.onRemove(row.id)}
          >移除</Button>
        </Space>,
      }] : []),
    ]}/>
    {value.billingIdentity&&<><Typography.Title level={5}>账单主体</Typography.Title><Descriptions bordered size="small" column={{xs:1,sm:2}} items={[
      {key:'name',label:'名称',children:value.billingIdentity.name??'—'},
      {key:'email',label:'邮箱',children:value.billingIdentity.email??'—'},
      {key:'tax',label:'税号',children:value.billingIdentity.taxId??'—'},
      {key:'address',label:'地址',span:2,children:value.billingIdentity.address??'—'},
    ]}/></>}
    {value.seatTypeCounts&&<><Typography.Title level={5}>计费席位</Typography.Title><Descriptions bordered size="small" column={{xs:1,sm:2}} items={[
      {key:'default',label:'ChatGPT 固定席位',children:value.seatTypeCounts.default},
      {key:'usage',label:'Codex 席位',children:value.seatTypeCounts.usageBased},
    ]}/></>}
  </Space>;
}

function InvoiceTable({ invoices, empty, upcoming=false }: { invoices: BillingInvoiceView[]; empty:string; upcoming?:boolean }) {
  return <Table rowKey="id" size="small" pagination={false} dataSource={invoices} locale={{emptyText:empty}} scroll={{x:950}} columns={[
    {title:upcoming?'状态':'发票',render:(_,row)=><Space direction="vertical" size={1}>{!upcoming&&<Typography.Text strong>{row.number??row.externalId??row.id}</Typography.Text>}<Tag>{statusLabels[row.status??'unknown']??row.status??'未知'}</Tag>{row.billingReason&&<Typography.Text type="secondary">{row.billingReason}</Typography.Text>}</Space>},
    {title:upcoming?'预计扣款':'金额',render:(_,row)=><Space direction="vertical" size={1}><Typography.Text strong>{money(row.amountDue??row.total,row.currency)}</Typography.Text>{row.subtotal!==undefined&&<Typography.Text type="secondary">小计 {money(row.subtotal,row.currency)} · 税 {money(row.tax,row.currency)}</Typography.Text>}{row.amountRemaining!==undefined&&<Typography.Text type="secondary">剩余 {money(row.amountRemaining,row.currency)}</Typography.Text>}</Space>},
    {title:'项目',render:(_,row)=><Space direction="vertical" size={1}><span>{row.lineDescription??'—'}</span>{(row.lineQuantity!==undefined||row.lineUnitAmount!==undefined)&&<Typography.Text type="secondary">数量 {row.lineQuantity??'—'} · 单价 {money(row.lineUnitAmount,row.currency)}</Typography.Text>}</Space>},
    {title:'账期',render:(_,row)=>row.periodStart||row.periodEnd?`${formatTime(row.periodStart)} — ${formatTime(row.periodEnd)}`:'—'},
    {title:upcoming?'预计扣款时间':'开票时间',render:(_,row)=>formatTime(upcoming?row.nextPaymentAttempt:row.createdAt)},
    ...(!upcoming?[{title:'链接',render:(_:unknown,row:BillingInvoiceView)=><Space>{row.hostedInvoiceUrl&&<Typography.Link href={row.hostedInvoiceUrl} target="_blank" rel="noreferrer">在线发票</Typography.Link>}{row.invoicePdfUrl&&<Typography.Link href={row.invoicePdfUrl} target="_blank" rel="noreferrer">PDF</Typography.Link>}{!row.hostedInvoiceUrl&&!row.invoicePdfUrl?'—':null}</Space>}]:[]),
  ]}/>;
}

export function ActivityTimeline({ value, pageKey='activityPage' }: { value: AccountActivityView[]; pageKey?:string }) {
  const pagination=useUrlPagination({total:value.length,pageKey,pageSizeStorageKey:"account-activity",defaultPageSize:30});
  return <Table rowKey="id" size="small" pagination={pagination} dataSource={value} locale={{emptyText:'暂无活动记录'}} columns={[
    {title:'时间',dataIndex:'occurredAt',width:190,render:formatTime},
    {title:'事件',dataIndex:'title',width:220},
    {title:'说明',dataIndex:'detail',render:(v)=>v??'—'},
  ]}/>;
}

export function formatMoney(amount?:number|string,currency?:string){const value=typeof amount==='string'?Number(amount):amount;if(value===undefined||!Number.isFinite(value)||!currency)return '—';try{return new Intl.NumberFormat('zh-CN',{style:'currency',currency:currency.toUpperCase()}).format(value/100);}catch{return `${(value/100).toFixed(2)} ${currency.toUpperCase()}`;}}
const money=formatMoney;

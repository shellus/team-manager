import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { temporaryDirectory } from './testHelpers.js';
import { ArtifactStore } from './artifactStore.js';
import { createCodexAuthSession } from './codexAuth.js';
import { TeamCodeClient } from './teamCodeClient.js';
import { configuredNotificationChannels, NotificationService } from './services/notificationService.js';
import { teamOrderScheduledFor } from './services/teamOrderService.js';
import { ChatGptApi } from './chatgptApi.js';
import { notificationScheduleDue } from './services/seatSlotService.js';

test('Codex OAuth 会话使用 PKCE 且固定回调', () => {
  const session=createCodexAuthSession('account@example.com');const url=new URL(session.authUrl);
  assert.equal(url.origin+url.pathname,'https://auth.openai.com/oauth/authorize');
  assert.equal(url.searchParams.get('redirect_uri'),'http://localhost:1455/auth/callback');
  assert.equal(url.searchParams.get('login_hint'),'account@example.com');assert.ok(session.codeVerifier.length>=43);
});

test('ArtifactStore 保持原始正文并校验哈希', async () => {
  const root=await temporaryDirectory();const store=new ArtifactStore(root);const content=Buffer.from('{"session":"raw"}');
  const saved=await store.writeImmutable('traces','trace.json',content);assert.deepEqual(await store.read(saved.storageKey,saved.contentSha256),content);
  assert.equal((await readFile(store.resolveStorageKey(saved.storageKey))).toString(),content.toString());
});

test('TeamCode 未配置时明确拒绝生成', async () => {
  const client=new TeamCodeClient();await assert.rejects(()=>client.generateOrder({account:{email:'a@example.com',accountId:'w',accessToken:'t'},workspaceName:'W',config:{promoCode:'',country:'US',currency:'USD'}}),/尚未配置/);
});

test('个人账单只请求个人账号支持的三类接口', async () => {
  const paths:string[]=[];const transport={fetch:async(request:any)=>{paths.push(request.path);return{status:200,body:'{}'};}};
  await new ChatGptApi({accountId:'personal-account',accessToken:'token'},transport).getPersonalBillingSnapshotRaw();
  assert.deepEqual(paths.sort(),[
    '/backend-api/invoices?limit=10&account_id=personal-account',
    '/backend-api/payments/billing_info?account_id=personal-account',
    '/backend-api/payments/payment_methods?account_id=personal-account'
  ]);
});

test('手动 Team 订单立即执行，仅定时维护采用错峰', () => {
  const now=new Date('2026-08-13T00:00:00Z');assert.equal(teamOrderScheduledFor('manual','workspace-1',now).getTime(),now.getTime());assert.equal(teamOrderScheduledFor('manual_all','workspace-1',now).getTime(),now.getTime());
  const scheduled=teamOrderScheduledFor('scheduled','workspace-1',now).getTime();assert.ok(scheduled>=now.getTime());assert.ok(scheduled<now.getTime()+10*60_000);
});

test('通知策略的触发时间按配置时区生效', () => {
  const now = new Date('2026-08-13T01:30:00Z');
  assert.equal(notificationScheduleDue({ triggerTime: '09:30', timeZone: 'Asia/Shanghai' }, now), true);
  assert.equal(notificationScheduleDue({ triggerTime: '09:31', timeZone: 'Asia/Shanghai' }, now), false);
  assert.equal(notificationScheduleDue({ triggerTime: '01:30', timeZone: 'UTC' }, now), true);
});

test('通知渠道可独立停用且兼容旧配置', () => {
  assert.deepEqual(configuredNotificationChannels({webhookUrl:'https://notify.test'}),['webhook']);
  assert.deepEqual(configuredNotificationChannels({webhookEnabled:false,webhookUrl:'https://notify.test',feishuEnabled:true,feishuWebhookUrl:'https://feishu.test'}),['feishu']);
  assert.deepEqual(configuredNotificationChannels({telegramEnabled:true,telegramBotToken:'token'}),[]);
});

test('通知失败在同一投递上有限重试并保留原始正文', async () => {
  const {db,deliveries}=notificationDatabase();let body='';const fakeFetch=async(_input:RequestInfo|URL,init?:RequestInit)=>{body=String(init?.body??'');return new Response('{}',{status:500});};
  const service=new NotificationService(db,fakeFetch as typeof fetch);const payload={type:'expiration',text:'raw notification',secret:'unredacted-value'};
  await assert.rejects(()=>service.send('expiration',payload),/HTTP 500/);assert.equal(deliveries.length,1);assert.deepEqual(deliveries[0].payload,payload);assert.equal(deliveries[0].attempt_count,1);
  await assert.rejects(()=>service.retry(deliveries[0].id),/HTTP 500/);await assert.rejects(()=>service.retry(deliveries[0].id),/HTTP 500/);
  assert.equal(deliveries.length,1);assert.equal(deliveries[0].attempt_count,3);assert.equal(deliveries[0].status,'exhausted');assert.match(body,/unredacted-value/);
  await assert.rejects(()=>service.retry(deliveries[0].id),/最大重试次数/);
});

function chain(row:any){const q:any={selectAll:()=>q,select:()=>q,where:()=>q,innerJoin:()=>q,orderBy:()=>q,limit:()=>q,executeTakeFirst:async()=>row,execute:async()=>row?[row]:[]};return q;}

function notificationDatabase(){
  const policy={id:'policy-1',kind:'expiration',enabled:true,configuration:{webhookUrl:'https://notify.test'}};const deliveries:any[]=[];
  const db:any={
    selectFrom(table:string){const filters:any[]=[];const query:any={selectAll:()=>query,select:()=>query,innerJoin:()=>query,orderBy:()=>query,limit:()=>query,where:(column:string,operator:string,value:any)=>{filters.push([column.split('.').at(-1),operator,value]);return query;},executeTakeFirst:async()=>rows(table).find(matches(filters)),executeTakeFirstOrThrow:async()=>rows(table).find(matches(filters))??Promise.reject(new Error('missing')),execute:async()=>rows(table).filter(matches(filters))};return query;},
    insertInto(table:string){return{values:(values:any)=>({returning:()=>({executeTakeFirstOrThrow:async()=>{const row={id:`delivery-${deliveries.length+1}`,created_at:new Date(),...values};if(table==='notification_deliveries')deliveries.push(row);return row;}})})};},
    updateTable(_table:string){return{set:(values:any)=>{const filters:any[]=[];const query:any={where:(column:string,operator:string,value:any)=>{filters.push([column.split('.').at(-1),operator,value]);return query;},returning:()=>query,executeTakeFirst:async()=>{const row=deliveries.find(matches(filters));if(row)Object.assign(row,values);return row;},execute:async()=>{for(const row of deliveries.filter(matches(filters)))Object.assign(row,values);}};return query;}};}
  };
  function rows(table:string){if(table.startsWith('notification_policies'))return[policy];if(table.startsWith('notification_deliveries as'))return deliveries.map(row=>({...row,configuration:policy.configuration,kind:policy.kind}));return deliveries;}
  return{db,deliveries};
}
function matches(filters:any[]){return(row:any)=>filters.every(([key,operator,value])=>operator==='='?row[key]===value:operator==='in'?value.includes(row[key]):operator==='<'?row[key]<value:operator==='<='?row[key]<=value:true);}

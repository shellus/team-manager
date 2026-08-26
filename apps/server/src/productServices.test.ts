import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { temporaryDirectory } from './testHelpers.js';
import { ArtifactStore } from './artifactStore.js';
import { createCodexAuthSession } from './codexAuth.js';
import { TeamCodeClient, teamCodeOrderPayload } from './teamCodeClient.js';
import { configuredNotificationChannels, notificationRequests, NotificationService, sendConfiguration } from './services/notificationService.js';
import { teamOrderScheduledFor } from './services/teamOrderService.js';
import { ChatGptApi } from './chatgptApi.js';
import { notificationScheduleDue } from './services/seatSlotService.js';
import { mergeBillingSnapshotPayload } from './repositories/billingRepository.js';
import { MAX_NOTIFICATION_TEXT_BYTES, notificationTextBytes, notificationTestMessage, seatExpiryMessage } from './domain/notificationMessage.js';
import { seatSlotRelationFromFacts } from './repositories/seatSlotRelationRepository.js';

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
  await store.remove(saved.storageKey);
  await assert.rejects(readFile(store.resolveStorageKey(saved.storageKey)), { code: 'ENOENT' });
});

test('TeamCode 未配置时明确拒绝生成', async () => {
  const client=new TeamCodeClient();await assert.rejects(()=>client.generateOrder({account:{email:'a@example.com',accountId:'w',accessToken:'t'},workspaceName:'W',config:{promoCode:'',country:'US',currency:'USD',seatQuantity:4}}),/尚未配置/);
});

test('TeamCode 使用订单合同中的显式席位数，并区分 Session 与目标 Workspace', () => {
  const payload=teamCodeOrderPayload({account:{email:'a@example.com',accountId:'personal',accessToken:'t'},targetWorkspaceId:'workspace',workspaceName:'W',config:{promoCode:'P',country:'US',currency:'USD',seatQuantity:4}});
  assert.equal(payload.order.seatQuantity,4);
  assert.equal(payload.session.account.id,'personal');
  assert.equal(payload.order.workspaceId,'workspace');
  const createPayload=teamCodeOrderPayload({account:{email:'a@example.com',accountId:'personal',accessToken:'t'},workspaceName:'New',config:{promoCode:'',country:'US',currency:'USD',seatQuantity:2}});
  assert.equal(createPayload.order.workspaceId,'');
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

test('个人账单和支付方式可独立请求并合并为完整快照', async () => {
  const paths:string[]=[];const transport={fetch:async(request:any)=>{paths.push(request.path);return{status:200,body:'{}'};}};
  const api=new ChatGptApi({accountId:'personal-account',accessToken:'token'},transport);
  const billing=await api.getPersonalBillingDetailsRaw();
  assert.deepEqual(paths.sort(),[
    '/backend-api/invoices?limit=10&account_id=personal-account',
    '/backend-api/payments/billing_info?account_id=personal-account'
  ]);
  paths.length=0;
  const paymentMethods=await api.getPersonalPaymentMethodsRaw();
  assert.deepEqual(paths,['/backend-api/payments/payment_methods?account_id=personal-account']);
  assert.deepEqual(mergeBillingSnapshotPayload({paymentMethods:{old:true}},billing),{
    paymentMethods:{old:true},invoices:{},billingInfo:{}
  });
  assert.deepEqual(mergeBillingSnapshotPayload({invoices:{old:true}}, {paymentMethods}),{
    invoices:{old:true},paymentMethods:{}
  });
});

test('Workspace 邀请未选择席位时省略 seat_type', async () => {
  const requests:any[]=[];const transport={fetch:async(request:any)=>{requests.push(request);return{status:200,body:'{}'};}};
  const api=new ChatGptApi({accountId:'workspace-account',accessToken:'token'},transport);
  await api.invite('member@example.com',undefined,'standard-user');
  assert.deepEqual(JSON.parse(requests[0].body),{
    email_addresses:['member@example.com'],role:'standard-user',resend_emails:true
  });
});

test('Workspace 自助加入请求使用目标 Workspace 路径与账号上下文', async () => {
  const requests:any[]=[];
  const transport={fetch:async(request:any)=>{requests.push(request);return{status:200,body:'{}'};}};
  const api=new ChatGptApi({accountId:'0a9b56ec-c0a2-473f-a8ea-8f25ef8cc5fc',accessToken:'token'},transport);
  await api.requestWorkspaceInvite();
  assert.equal(requests.length,1);
  assert.equal(requests[0].method,'POST');
  assert.equal(requests[0].path,'/backend-api/accounts/0a9b56ec-c0a2-473f-a8ea-8f25ef8cc5fc/invites/request');
  assert.equal(requests[0].headers['chatgpt-account-id'],'0a9b56ec-c0a2-473f-a8ea-8f25ef8cc5fc');
  assert.deepEqual(JSON.parse(requests[0].body),{});
});

test('Workspace 成员和邀请响应缺少席位时保持未知', async () => {
  const transport={fetch:async(request:any)=>({status:200,body:request.path.includes('/invites?')
    ? JSON.stringify({items:[{id:'invite-1',email_address:'invite@example.com',role:'standard-user',status:0,created_time:'2026-08-21T00:00:00Z',is_scim_managed:false}]})
    : JSON.stringify({items:[{id:'member-1',email:'member@example.com',role:'standard-user'}]})})};
  const api=new ChatGptApi({accountId:'workspace-account',accessToken:'token'},transport);
  assert.equal(Object.hasOwn((await api.listMembers())[0]!,'seat'),false);
  assert.equal(Object.hasOwn((await api.listPendingInvites())[0]!,'seat'),false);
});

test('Workspace 优惠码接口复用 Workspace 访问上下文并保留上游请求结构', async () => {
  const requests:any[]=[];const transport={fetch:async(request:any)=>{requests.push(request);return{status:200,body:request.path.includes('/eligibility/')?'{"is_eligible":true,"ineligible_reason":null}':request.path.includes('/metadata/')?'{"metadata":{"plan_name":"chatgptteamplan"},"is_eligible":true,"ineligible_reason":null}':'{}'};}};
  const api=new ChatGptApi({accountId:'workspace-account',accessToken:'token'},transport);
  await api.getPromotionEligibility('PROMO/CODE');
  await api.getPromotionMetadata('PROMO/CODE');
  await api.updateSubscriptionPromoCode('PROMO/CODE');
  await api.getSubscription();
  assert.deepEqual(requests.map((request)=>[request.method,request.path]),[
    ['GET','/backend-api/promotions/eligibility/PROMO%2FCODE?type=promo'],
    ['GET','/backend-api/promotions/metadata/PROMO%2FCODE?type=promo'],
    ['POST','/backend-api/subscriptions/update'],
    ['GET','/backend-api/subscriptions?account_id=workspace-account']
  ]);
  assert.equal(requests[2].headers['chatgpt-account-id'],'workspace-account');
  assert.deepEqual(JSON.parse(requests[2].body),{account_id:'workspace-account',updated_promo_code:'PROMO/CODE'});
});

test('空 Workspace 订阅响应按未知订阅处理', async () => {
  const transport={fetch:async()=>({status:200,body:'null'})};
  const api=new ChatGptApi({accountId:'workspace-account',accessToken:'token'},transport);
  assert.deepEqual(await api.getSubscription(),{});
});

test('个人订阅缺少上游记录时按 Free 处理', async () => {
  const transport={fetch:async()=>({status:404,body:JSON.stringify({detail:'No subscription found for account'})})};
  const api=new ChatGptApi({accountId:'personal-account',accessToken:'token'},transport);
  assert.deepEqual(await api.getPersonalSubscriptionObservation(), {
    subscription: { plan_type: 'free' },
    missing: true
  });
  assert.deepEqual(await api.getPersonalSubscription(), { plan_type: 'free' });
});

test('个人订阅其他 404 仍按上游错误处理', async () => {
  const transport={fetch:async()=>({status:404,body:JSON.stringify({detail:'Account context is not available'})})};
  const api=new ChatGptApi({accountId:'personal-account',accessToken:'token'},transport);
  await assert.rejects(() => api.getPersonalSubscription(), /backend-api 404/);
});

test('个人套餐升级预览和提交复用 subscriptions/update 的实测协议', async () => {
  const requests:any[]=[];const transport={fetch:async(request:any)=>{requests.push(request);return{status:200,body:request.method==='GET'?'{"total_amount":481902,"positive_line_item_total":579464,"negative_line_item_total":-97562,"currency":"php"}':'{"success":true}'};}};
  const api=new ChatGptApi({accountId:'personal-account',accessToken:'token'},transport);
  await api.previewPersonalSubscriptionUpdate('chatgptprolite');
  await api.updatePersonalSubscription('chatgptprolite');
  assert.deepEqual(requests.map((request)=>[request.method,request.path]),[
    ['GET','/backend-api/subscriptions/update/preview?account_id=personal-account&updated_plan=chatgptprolite'],
    ['POST','/backend-api/subscriptions/update']
  ]);
  assert.deepEqual(JSON.parse(requests[1].body),{
    account_id:'personal-account',updated_plan:'chatgptprolite'
  });
});

test('Workspace API 任意 401 都用当前 Session 换取新 Token 并只重试一次', async () => {
  const tokens:string[]=[];let refreshes=0;
  const transport={fetch:async(request:any)=>{tokens.push(request.headers.Authorization);return tokens.length===1?{status:401,body:'{"detail":"Unauthorized"}'}:{status:200,body:'{"items":[]}'};}};
  const api=new ChatGptApi({accountId:'workspace-account',accessToken:'stale',refreshWebAccessToken:async()=>{refreshes+=1;return'fresh';}},transport);
  assert.deepEqual(await api.listMembers(),[]);
  assert.deepEqual(tokens,['Bearer stale','Bearer fresh']);
  assert.equal(refreshes,1);
});

test('Workspace API 新 Token 仍返回 401 时不循环刷新', async () => {
  let requests=0;let refreshes=0;
  const transport={fetch:async()=>{requests+=1;return{status:401,body:'{"detail":"Unauthorized"}'};}};
  const api=new ChatGptApi({accountId:'workspace-account',accessToken:'stale',refreshWebAccessToken:async()=>{refreshes+=1;return'fresh';}},transport);
  await assert.rejects(()=>api.listMembers(),/backend-api 401/);
  assert.equal(requests,2);assert.equal(refreshes,1);
});

test('手动 Team 订单立即执行，仅定时维护采用错峰', () => {
  const now=new Date('2026-08-13T00:00:00Z');assert.equal(teamOrderScheduledFor('manual','workspace-1',now).getTime(),now.getTime());assert.equal(teamOrderScheduledFor('manual_all','workspace-1',now).getTime(),now.getTime());
  const scheduled=teamOrderScheduledFor('scheduled','workspace-1',now).getTime();assert.ok(scheduled>=now.getTime());assert.ok(scheduled<now.getTime()+10*60_000);
});

test('通知策略的触发时间按配置时区生效', () => {
  const now = new Date('2026-08-13T01:30:00Z');
  assert.equal(notificationScheduleDue({ triggerTime: '09:30', timeZone: 'Asia/Shanghai' }, now), true);
  assert.equal(notificationScheduleDue({ triggerTime: '09:31', timeZone: 'Asia/Shanghai' }, now), false);
  assert.equal(notificationScheduleDue({ triggerTime: '09:00', timeZone: 'Asia/Shanghai' }, now), true,'错过精确分钟后当天仍应补发');
  assert.equal(notificationScheduleDue({ triggerTime: '01:30', timeZone: 'UTC' }, now), true);
});

test('客户席位关系只由当前成员和待接受邀请派生', () => {
  const slot = { workspace_id: 'workspace-1', current_email: 'Member@Example.com', normalized_current_email: 'member@example.com' };
  const memberships = [{ workspace_id: 'workspace-1', normalized_email: 'member@example.com', remote_user_id: 'remote-1', seat_type: 'default', status: 'active' }];
  const invitations = [{ workspace_id: 'workspace-1', normalized_email: 'member@example.com', seat_type: 'usage_based', status: 'pending' }];
  assert.deepEqual(seatSlotRelationFromFacts(slot, memberships, invitations), { status: 'member', remoteUserId: 'remote-1', seatType: 'default' });
  assert.deepEqual(seatSlotRelationFromFacts(slot, [], invitations), { status: 'invited', remoteUserId: null, seatType: 'usage_based' });
  assert.deepEqual(seatSlotRelationFromFacts(slot, [], []), { status: 'unlinked', remoteUserId: null });
  assert.deepEqual(seatSlotRelationFromFacts(slot, [{ ...memberships[0]!, normalized_email: null, account_email: 'Member@Example.com' }], []), { status: 'member', remoteUserId: 'remote-1', seatType: 'default' });
  assert.deepEqual(seatSlotRelationFromFacts({ ...slot, current_email: null, normalized_current_email: null }, memberships, invitations), { status: 'unclaimed', remoteUserId: null });
});

test('通知渠道可独立停用且兼容旧配置', () => {
  assert.deepEqual(configuredNotificationChannels({webhookUrl:'https://notify.test'}),['webhook']);
  assert.deepEqual(configuredNotificationChannels({webhookEnabled:false,webhookUrl:'https://notify.test',feishuEnabled:true,feishuWebhookUrl:'https://feishu.test'}),['feishu']);
  assert.deepEqual(configuredNotificationChannels({telegramEnabled:true,telegramBotToken:'token'}),[]);
});

test('四类通知渠道使用各自协议且只发送统一正文', () => {
  const payload={type:'seat_expiration',text:'统一正文',items:[{email:'member@example.com'}]};
  const requests=notificationRequests({webhookEnabled:true,webhookUrl:'https://generic.test',feishuEnabled:true,feishuWebhookUrl:'https://feishu.test',wecomEnabled:true,wecomWebhookUrl:'https://wecom.test',telegramEnabled:true,telegramBotToken:'token',telegramChatId:'chat'},payload);
  assert.deepEqual(requests.map(item=>item.channel),['webhook','feishu','wecom','telegram']);
  assert.deepEqual(requests[0].body,payload);
  assert.deepEqual(requests[1].body,{msg_type:'text',content:{text:'统一正文'}});
  assert.deepEqual(requests[2].body,{msgtype:'text',text:{content:'统一正文'}});
  assert.deepEqual(requests[3].body,{chat_id:'chat',text:'统一正文'});
});

test('渠道 HTTP 200 中的业务错误不会误记为成功', async () => {
  await assert.rejects(()=>sendConfiguration({wecomEnabled:true,wecomWebhookUrl:'https://wecom.test'},{text:'test'},[],async()=>undefined,async()=>new Response('{"errcode":40013,"errmsg":"invalid"}',{status:200}) as any),/wecom 返回失败：40013 invalid/);
  await assert.rejects(()=>sendConfiguration({feishuEnabled:true,feishuWebhookUrl:'https://feishu.test'},{text:'test'},[],async()=>undefined,async()=>new Response('{"code":19001,"msg":"bad"}',{status:200}) as any),/feishu 返回失败：19001 bad/);
  await assert.rejects(()=>sendConfiguration({telegramEnabled:true,telegramBotToken:'token',telegramChatId:'chat'},{text:'test'},[],async()=>undefined,async()=>new Response('{"ok":false}',{status:200}) as any),/telegram 返回失败/);
});

test('到期正文包含可执行明细、变更摘要并受跨渠道长度限制', () => {
  const items=Array.from({length:20},(_,index)=>({seatSlotId:`seat-${index}`,email:`member-${index}@example.com`,expiresOn:'2026-08-27',expireRemove:index%2===0,workspaceId:'workspace-1',workspaceName:'示例 Workspace'}));
  const message=seatExpiryMessage(items,{observedAt:'2026-08-25T01:00:00Z',timeZone:'Asia/Shanghai',windowStart:'2026-08-25',windowEnd:'2026-09-01',managementUrl:'https://manager.test/seat-overview'},items.slice(1));
  assert.match(message.text,/客户席位到期提醒｜20 项/);assert.match(message.text,/较上次：新增 1 项，移出提醒范围 0 项/);assert.match(message.text,/到期后自动移除/);assert.match(message.text,/到期后仅标记已到期/);assert.match(message.text,/另有 10 项未展开/);assert.match(message.text,/https:\/\/manager.test\/seat-overview/);assert.ok(notificationTextBytes(message.text)<=MAX_NOTIFICATION_TEXT_BYTES);
  assert.match(notificationTestMessage('seat_expiration',{observedAt:'2026-08-25T01:00:00Z',timeZone:'Asia/Shanghai'}).text,/测试通知｜不会触发业务操作/);
});

test('通知失败在同一投递上有限重试并保留原始正文', async () => {
  const {db,deliveries}=notificationDatabase();let body='';const fakeFetch=async(_input:RequestInfo|URL,init?:RequestInit)=>{body=String(init?.body??'');return new Response('{}',{status:500});};
  const service=new NotificationService(db,fakeFetch as typeof fetch);const payload={type:'expiration',text:'raw notification',secret:'unredacted-value'};
  await assert.rejects(()=>service.send('expiration',payload),/HTTP 500/);assert.equal(deliveries.length,1);assert.deepEqual(deliveries[0].payload,payload);assert.equal(deliveries[0].attempt_count,1);
  await assert.rejects(()=>service.retry(deliveries[0].id),/HTTP 500/);await assert.rejects(()=>service.retry(deliveries[0].id),/HTTP 500/);
  assert.equal(deliveries.length,1);assert.equal(deliveries[0].attempt_count,3);assert.equal(deliveries[0].status,'exhausted');assert.match(body,/unredacted-value/);
  await assert.rejects(()=>service.retry(deliveries[0].id),/最大重试次数/);
});

test('席位自动移除最终失败通过到期策略发送独立告警', async () => {
  const {db,deliveries}=notificationDatabase('seat_expiration');
  const service=new NotificationService(db,async()=>new Response('{}',{status:200}) as any);
  await service.notifySeatRemovalFailure({seatSlotId:'seat-1',email:'member@example.com',attemptCount:3,maxAttempts:3,error:'remove failed'});
  assert.equal(deliveries.length,1);assert.equal(deliveries[0].status,'delivered');
  assert.equal(deliveries[0].payload.type,'seat_expiration_removal_failed');assert.equal(deliveries[0].payload.summaryText,'客户席位自动移除失败｜需要人工处理');assert.match(deliveries[0].payload.text,/member@example.com/);assert.match(deliveries[0].payload.text,/有限重试已耗尽/);assert.match(deliveries[0].payload.text,/remove failed/);
});

test('多渠道部分成功后仅重试尚未成功的渠道', async () => {
  const {db,deliveries,policy}=notificationDatabase('seat_expiration');policy.configuration={webhookEnabled:true,webhookUrl:'https://generic.test',wecomEnabled:true,wecomWebhookUrl:'https://wecom.test'};
  const calls:string[]=[];let wecomAttempts=0;const service=new NotificationService(db,async(input)=>{const url=String(input);calls.push(url);if(url.includes('wecom')){wecomAttempts+=1;return new Response(wecomAttempts===1?'{"errcode":1,"errmsg":"busy"}':'{"errcode":0,"errmsg":"ok"}',{status:200});}return new Response('{}',{status:200});});
  await assert.rejects(()=>service.send('seat_expiration',{type:'test',text:'test'}),/wecom 返回失败/);assert.deepEqual(deliveries[0].delivered_channels,{webhook:true});
  await service.retry(deliveries[0].id);assert.equal(calls.filter(url=>url.includes('generic')).length,1);assert.equal(calls.filter(url=>url.includes('wecom')).length,2);assert.deepEqual(deliveries[0].delivered_channels,{webhook:true,wecom:true});assert.equal(deliveries[0].status,'delivered');
});

function chain(row:any){const q:any={selectAll:()=>q,select:()=>q,where:()=>q,innerJoin:()=>q,orderBy:()=>q,limit:()=>q,executeTakeFirst:async()=>row,execute:async()=>row?[row]:[]};return q;}

function notificationDatabase(kind='expiration'){
  const policy={id:'policy-1',kind,enabled:true,configuration:{webhookUrl:'https://notify.test'}};const deliveries:any[]=[];
  const db:any={
    selectFrom(table:string){const filters:any[]=[];const query:any={selectAll:()=>query,select:()=>query,innerJoin:()=>query,orderBy:()=>query,limit:()=>query,where:(column:string,operator:string,value:any)=>{filters.push([column.split('.').at(-1),operator,value]);return query;},executeTakeFirst:async()=>rows(table).find(matches(filters)),executeTakeFirstOrThrow:async()=>rows(table).find(matches(filters))??Promise.reject(new Error('missing')),execute:async()=>rows(table).filter(matches(filters))};return query;},
    insertInto(table:string){return{values:(values:any)=>({returning:()=>({executeTakeFirstOrThrow:async()=>{const row={id:`delivery-${deliveries.length+1}`,created_at:new Date(),...values};if(table==='notification_deliveries')deliveries.push(row);return row;}})})};},
    updateTable(_table:string){return{set:(values:any)=>{const filters:any[]=[];const query:any={where:(column:string,operator:string,value:any)=>{filters.push([column.split('.').at(-1),operator,value]);return query;},returning:()=>query,executeTakeFirst:async()=>{const row=deliveries.find(matches(filters));if(row)Object.assign(row,values);return row;},execute:async()=>{for(const row of deliveries.filter(matches(filters)))Object.assign(row,values);}};return query;}};}
  };
  function rows(table:string){if(table.startsWith('notification_policies'))return[policy];if(table.startsWith('notification_deliveries as'))return deliveries.map(row=>({...row,configuration:policy.configuration,kind:policy.kind}));return deliveries;}
  return{db,deliveries,policy};
}
function matches(filters:any[]){return(row:any)=>filters.every(([key,operator,value])=>operator==='='?row[key]===value:operator==='in'?value.includes(row[key]):operator==='<'?row[key]<value:operator==='<='?row[key]<=value:true);}

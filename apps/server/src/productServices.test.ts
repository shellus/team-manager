import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { temporaryDirectory } from './testHelpers.js';
import { ArtifactStore } from './artifactStore.js';
import { createCodexAuthSession } from './codexAuth.js';
import { TeamCodeClient } from './teamCodeClient.js';
import { NotificationService } from './services/notificationService.js';

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

test('通知投递使用新版扁平配置并记录结果', async () => {
  const deliveries:any[]=[];let body='';const fakeFetch=async(_input:RequestInfo|URL,init?:RequestInit)=>{body=String(init?.body??'');return new Response('{}',{status:200});};
  const db:any={selectFrom:()=>chain({id:'p',kind:'expiration',configuration:{webhookUrl:'https://notify.test'}}),insertInto:()=>({values:()=>({returning:()=>({executeTakeFirstOrThrow:async()=>({id:'d'})})})}),updateTable:()=>({set:(v:any)=>({where:()=>({execute:async()=>{deliveries.push(v);}})})})};
  const service=new NotificationService(db,fakeFetch as typeof fetch);const result=await service.test('expiration');assert.equal(result.status,'delivered');assert.match(body,/通知测试/);assert.equal(deliveries[0].status,'delivered');
});

function chain(row:any){const q:any={selectAll:()=>q,select:()=>q,where:()=>q,innerJoin:()=>q,orderBy:()=>q,limit:()=>q,executeTakeFirst:async()=>row,execute:async()=>row?[row]:[]};return q;}

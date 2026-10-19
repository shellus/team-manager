import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { buildMihomoConfig, residentialUsername, ResidentialProxyGateway, type ResidentialProxyGatewayConfig } from './residentialProxyGateway.js';
import { normalizeResidentialProxy } from './services/residentialProxyService.js';
import { ServiceError } from './serviceError.js';

const accountId = '3f6c2a10-8d4e-4b7a-9c21-5e0d7f4a1b23';
const config = (configPath = '/tmp/residential.yaml'): ResidentialProxyGatewayConfig => ({
  upstreamProxy: 'socks5://user123:upstream-secret@residential.example:3000',
  normalProxy: 'http://front-proxy.example:7890',
  stickyMinutes: 120,
  listenPort: 3016,
  gatewayUrl: 'http://residential-proxy:3016',
  gatewayPassword: 'gateway-secret',
  configPath,
  controllerConfigPath: '/root/.config/mihomo/config.yaml',
  controllerUrl: 'http://residential-proxy:9090',
  controllerSecret: 'controller-secret'
});

test('住宅上游用户名按国家、州、城市与 SID 拼接', () => {
  assert.equal(
    residentialUsername(config(), { sid: 'Ab12Cd34', country: 'SG', asn: null, state: null, city: null }),
    'user123-region-SG-sid-Ab12Cd34-t-120'
  );
  assert.equal(
    residentialUsername(config(), { sid: 'Ab12Cd34', country: 'US', asn: null, state: 'Texas', city: 'Abilene' }),
    'user123-region-US-st-Texas-city-Abilene-sid-Ab12Cd34-t-120'
  );
});

test('网关配置为每个账号生成认证用户、住宅节点与 IN-USER 规则，静态资源走前置', () => {
  const built = buildMihomoConfig(config(), [
    { accountId, config: { sid: 'Ab12Cd34', country: 'SG', asn: null, state: null, city: null } }
  ]) as any;
  assert.equal(built['mixed-port'], 3016);
  assert.deepEqual(built.authentication, [`${accountId}:gateway-secret`]);
  const node = built.proxies.find((item: any) => item.name === `RES-${accountId}`);
  assert.equal(node.username, 'user123-region-SG-sid-Ab12Cd34-t-120');
  assert.equal(node.password, 'upstream-secret');
  assert.equal(node['dialer-proxy'], 'NORMAL');
  assert.ok(built.rules.includes(`IN-USER,${accountId},RES-${accountId}`));
  assert.ok(built.rules.includes('DOMAIN-SUFFIX,oaistatic.com,NORMAL'));
  assert.equal(built.rules.at(-1), 'MATCH,NORMAL');
  assert.deepEqual(buildMihomoConfig(config(), []).authentication, ['disabled:gateway-secret']);
});

test('网关同步写入配置后热加载，并只断开目标账号的连接', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tm-residential-'));
  try {
    const requests: Array<[string, string, string | undefined]> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      requests.push([init?.method ?? 'GET', `${url.pathname}${url.search}`, init?.body ? String(init.body) : undefined]);
      if (url.pathname === '/connections' && (init?.method ?? 'GET') === 'GET') {
        return Response.json({ connections: [
          { id: 'mine', metadata: { inboundUser: accountId } },
          { id: 'other', metadata: { inboundUser: 'someone-else' } }
        ] });
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const gateway = new ResidentialProxyGateway(config(join(dir, 'config.yaml')), async () => [
      { accountId, config: { sid: 'Ab12Cd34', country: 'SG', asn: null, state: null, city: null } }
    ], fetchImpl);
    await gateway.sync({ closeAccountId: accountId });
    const written = parse(await readFile(join(dir, 'config.yaml'), 'utf8'));
    assert.deepEqual(written.authentication, [`${accountId}:gateway-secret`]);
    assert.deepEqual(requests, [
      ['PUT', '/configs?force=true', JSON.stringify({ path: '/root/.config/mihomo/config.yaml' })],
      ['GET', '/connections', undefined],
      ['DELETE', '/connections/mine', undefined]
    ]);
    assert.equal(gateway.proxyUrl(accountId), `http://${accountId}:gateway-secret@residential-proxy:3016`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('住宅代理配置规范化国家并拒绝无效 SID、互斥定位和用户名分隔符', () => {
  assert.deepEqual(normalizeResidentialProxy({ sid: ' Ab12Cd34 ', country: 'sg', asn: null, state: '', city: null }),
    { sid: 'Ab12Cd34', country: 'SG', asn: null, state: null, city: null });
  for (const input of [
    { sid: 'short', country: 'SG' },
    { sid: 'Ab12Cd34', country: 'SGP' },
    { sid: 'Ab12Cd34', country: 'US', asn: '7922', state: 'Texas' },
    { sid: 'Ab12Cd34', country: 'US', city: 'Abilene' },
    { sid: 'Ab12Cd34', country: 'US', state: 'North-Carolina' }
  ]) {
    assert.throws(() => normalizeResidentialProxy(input as any), (error) => error instanceof ServiceError && error.status === 400);
  }
});

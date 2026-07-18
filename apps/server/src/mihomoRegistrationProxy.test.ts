import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMihomoConfig, buildResidentialUsername } from './mihomoRegistrationProxy.js';

const config = {
  configPath: '/tmp/config.yaml',
  controllerConfigPath: '/root/.config/mihomo/config.yaml',
  controllerUrl: 'http://127.0.0.1:3013',
  controllerSecret: 'controller-secret',
  listenPort: 3012,
  gatewayPassword: 'gateway-password',
  normalProxy: 'http://host.docker.internal:7890',
  residentialProxy: 'socks5://account:password@residential.example:3000',
  residentialRegion: 'US',
  residentialState: 'Texas',
  residentialTtlSeconds: 120,
  dataDir: '/tmp'
};

describe('Mihomo registration proxy', () => {
  it('builds one isolated residential outbound per browser profile session', () => {
    const rendered = buildMihomoConfig(config, ['profile-session']);
    assert.deepEqual(rendered.authentication, ['profile-session:gateway-password']);
    assert.deepEqual((rendered.proxies as Array<Record<string, unknown>>)[1], {
      name: 'RES-profile-session',
      type: 'socks5',
      server: 'residential.example',
      port: 3000,
      username: 'account-region-US-st-Texas-sid-profile-session-t-120',
      password: 'password',
      udp: false,
      'dialer-proxy': 'NORMAL'
    });
  });

  it('routes static domains before the per-user residential rule', () => {
    const rules = buildMihomoConfig(config, ['profile-session']).rules as string[];
    assert.ok(rules.indexOf('DOMAIN-SUFFIX,oaistatic.com,NORMAL') < rules.indexOf('IN-USER,profile-session,RES-profile-session'));
    assert.ok(rules.indexOf('DOMAIN-SUFFIX,openaiassets.blob.core.windows.net,NORMAL') < rules.indexOf('IN-USER,profile-session,RES-profile-session'));
    assert.ok(rules.indexOf('DOMAIN-SUFFIX,js.stripe.com,NORMAL') < rules.indexOf('IN-USER,profile-session,RES-profile-session'));
    assert.ok(rules.indexOf('DOMAIN-SUFFIX,stripecdn.com,NORMAL') < rules.indexOf('IN-USER,profile-session,RES-profile-session'));
    assert.equal(rules.at(-1), 'MATCH,NORMAL');
  });

  it('keeps CAPTCHA and payment API domains on the profile residential route', () => {
    const rules = buildMihomoConfig(config, ['profile-session']).rules as string[];
    assert.equal(rules.includes('DOMAIN-SUFFIX,newassets.hcaptcha.com,NORMAL'), false);
    assert.equal(rules.includes('DOMAIN-SUFFIX,api.hcaptcha.com,NORMAL'), false);
    assert.equal(rules.includes('DOMAIN-SUFFIX,api.stripe.com,NORMAL'), false);
    assert.equal(rules.includes('DOMAIN-SUFFIX,checkout.stripe.com,NORMAL'), false);
  });

  it('does not expose an unauthenticated proxy before the first registration session exists', () => {
    const rendered = buildMihomoConfig(config, []);
    assert.deepEqual(rendered.authentication, ['disabled:gateway-password']);
  });

  it('builds the same 1024 username shape used by teamcode', () => {
    assert.equal(
      buildResidentialUsername(config, 'profile-session'),
      'account-region-US-st-Texas-sid-profile-session-t-120'
    );
  });
});

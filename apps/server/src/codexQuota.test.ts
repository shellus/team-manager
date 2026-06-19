import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Transport } from './transport.js';
import { buildCodexQuotaSnapshot, fetchCodexQuota } from './codexQuota.js';

class RecordingTransport implements Transport {
  requests: Array<{ method: string; path: string; headers: Record<string, string>; body?: string }> = [];

  constructor(private readonly responseBody: string) {}

  async fetch(req: { method: string; path: string; headers: Record<string, string>; body?: string }) {
    this.requests.push(req);
    return { status: 200, body: this.responseBody };
  }
}

describe('Codex quota', () => {
  it('parses Codex usage payload into quota windows', () => {
    const snapshot = buildCodexQuotaSnapshot({
      plan_type: 'team',
      rate_limit: {
        primary_window: {
          used_percent: 35,
          resets_at: 1781751600,
          limit_window_seconds: 18000
        },
        secondary_window: {
          used_percent: 70,
          resets_at: '2026-06-25T00:00:00.000Z',
          limit_window_seconds: 604800
        }
      },
      additional_rate_limits: [
        {
          limit_name: 'gpt-5',
          rate_limit: {
            primary_window: {
              used_percent: '20',
              resets_at: 1781751600,
              limit_window_seconds: 18000
            }
          }
        }
      ]
    });

    assert.equal(snapshot.status, 'success');
    assert.equal(snapshot.planType, 'team');
    assert.deepEqual(
      snapshot.windows.map((window) => [window.id, window.label, window.usedPercent]),
      [
        ['code-five-hour', '5 小时', 35],
        ['code-weekly', '7 天', 70],
        ['code-gpt-5-five-hour', 'gpt-5 5 小时', 20]
      ]
    );
    assert.equal(snapshot.error, null);
  });

  it('queries wham usage directly with the Codex credential access token', async () => {
    const transport = new RecordingTransport(
      JSON.stringify({
        plan_type: 'team',
        rate_limit: {
          primary_window: {
            used_percent: 12,
            limit_window_seconds: 18000
          }
        }
      })
    );

    const snapshot = await fetchCodexQuota(
      {
        id_token: 'id-token',
        access_token: 'codex-access-token',
        refresh_token: 'refresh-token',
        account_id: 'child-account-id',
        last_refresh: '2026-06-18T00:00:00.000Z',
        email: 'child@example.com',
        type: 'codex',
        expired: '2026-06-18T01:00:00.000Z'
      },
      transport
    );

    assert.equal(snapshot.status, 'success');
    assert.equal(transport.requests[0]!.method, 'GET');
    assert.equal(transport.requests[0]!.path, '/backend-api/wham/usage');
    assert.equal(transport.requests[0]!.headers.Authorization, 'Bearer codex-access-token');
    assert.equal(transport.requests[0]!.headers['Chatgpt-Account-Id'], 'child-account-id');
    assert.equal(transport.requests[0]!.headers['User-Agent'], 'codex_cli_rs/0.76.0 team-manager');
  });
});

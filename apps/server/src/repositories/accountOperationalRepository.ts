import type { Kysely } from 'kysely';
import type { ResidentialProxyConfig } from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import { SecretCipher } from '../secretCipher.js';
import type { ResidentialProxyEntry } from '../residentialProxyGateway.js';

export class AccountOperationalRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly cipher: SecretCipher,
    private readonly residentialProxyUrl?: (accountId: string) => string
  ) {}

  /** 账号实际使用的 HTTP 代理：住宅代理配置优先，其次是手工填写的代理地址。 */
  async proxy(accountId: string): Promise<string | undefined> {
    const row = await this.db.selectFrom('account_operational_profiles').selectAll().where('account_id', '=', accountId).executeTakeFirst();
    if (row?.residential_proxy_sid && this.residentialProxyUrl) return this.residentialProxyUrl(accountId);
    if (!row?.proxy_url_ciphertext || !row.proxy_url_nonce || !row.proxy_url_auth_tag || !row.proxy_url_key_version) return undefined;
    return this.cipher.decrypt({
      ciphertext: row.proxy_url_ciphertext,
      nonce: row.proxy_url_nonce,
      authTag: row.proxy_url_auth_tag,
      keyVersion: row.proxy_url_key_version
    }, `account-proxy:${accountId}`);
  }

  /** 设置手工代理地址；手工代理与住宅代理互斥。 */
  async setProxy(accountId: string, proxy: string | null): Promise<void> {
    const value = proxy?.trim();
    const encrypted = value ? this.cipher.encrypt(value, `account-proxy:${accountId}`) : undefined;
    const result = await this.db.updateTable('account_operational_profiles').set({
      proxy_url_ciphertext: encrypted?.ciphertext ?? null,
      proxy_url_nonce: encrypted?.nonce ?? null,
      proxy_url_auth_tag: encrypted?.authTag ?? null,
      proxy_url_key_version: encrypted?.keyVersion ?? null,
      ...(encrypted ? residentialColumns(null) : {})
    }).where('account_id', '=', accountId).executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new Error('账号不存在');
  }

  async residentialProxy(accountId: string): Promise<ResidentialProxyConfig | undefined> {
    const row = await this.db.selectFrom('account_operational_profiles').selectAll().where('account_id', '=', accountId).executeTakeFirst();
    return row ? residentialConfig(row) : undefined;
  }

  /** 保存住宅代理配置并清除手工代理地址；传 null 清除住宅代理。 */
  async setResidentialProxy(accountId: string, config: ResidentialProxyConfig | null): Promise<void> {
    const result = await this.db.updateTable('account_operational_profiles').set({
      ...residentialColumns(config),
      ...(config ? {
        proxy_url_ciphertext: null,
        proxy_url_nonce: null,
        proxy_url_auth_tag: null,
        proxy_url_key_version: null
      } : {})
    }).where('account_id', '=', accountId).executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new Error('账号不存在');
  }

  async residentialProxies(): Promise<ResidentialProxyEntry[]> {
    const rows = await this.db.selectFrom('account_operational_profiles').selectAll()
      .where('residential_proxy_sid', 'is not', null).orderBy('account_id').execute();
    return rows.flatMap((row) => {
      const config = residentialConfig(row);
      return config ? [{ accountId: row.account_id, config }] : [];
    });
  }

  async updateLimitType(accountId: string, limitType: 'unknown' | 'weekly' | 'monthly'): Promise<void> {
    const result = await this.db.updateTable('account_operational_profiles').set({ limit_type: limitType })
      .where('account_id', '=', accountId).executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new Error('账号不存在');
  }
}

function residentialColumns(config: ResidentialProxyConfig | null) {
  return {
    residential_proxy_sid: config?.sid ?? null,
    residential_proxy_country: config?.country ?? null,
    residential_proxy_asn: config?.asn ?? null,
    residential_proxy_state: config?.state ?? null,
    residential_proxy_city: config?.city ?? null
  };
}

function residentialConfig(row: {
  residential_proxy_sid: string | null;
  residential_proxy_country: string | null;
  residential_proxy_asn: string | null;
  residential_proxy_state: string | null;
  residential_proxy_city: string | null;
}): ResidentialProxyConfig | undefined {
  if (!row.residential_proxy_sid || !row.residential_proxy_country) return undefined;
  return {
    sid: row.residential_proxy_sid,
    country: row.residential_proxy_country,
    asn: row.residential_proxy_asn,
    state: row.residential_proxy_state,
    city: row.residential_proxy_city
  };
}

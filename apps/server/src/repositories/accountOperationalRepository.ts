import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { SecretCipher, type EncryptedValue } from '../secretCipher.js';

export class AccountOperationalRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly cipher: SecretCipher
  ) {}

  async proxy(accountId: string): Promise<string | undefined> {
    const row = await this.db.selectFrom('account_operational_profiles').selectAll().where('account_id', '=', accountId).executeTakeFirst();
    if (!row?.proxy_url_ciphertext || !row.proxy_url_nonce || !row.proxy_url_auth_tag || !row.proxy_url_key_version) return undefined;
    return this.cipher.decrypt({
      ciphertext: row.proxy_url_ciphertext,
      nonce: row.proxy_url_nonce,
      authTag: row.proxy_url_auth_tag,
      keyVersion: row.proxy_url_key_version
    }, `account-proxy:${accountId}`);
  }

  async setProxy(accountId: string, proxy: string | null): Promise<void> {
    const value = proxy?.trim();
    const encrypted = value ? this.cipher.encrypt(value, `account-proxy:${accountId}`) : undefined;
    const result = await this.db.updateTable('account_operational_profiles').set({
      proxy_url_ciphertext: encrypted?.ciphertext ?? null,
      proxy_url_nonce: encrypted?.nonce ?? null,
      proxy_url_auth_tag: encrypted?.authTag ?? null,
      proxy_url_key_version: encrypted?.keyVersion ?? null
    }).where('account_id', '=', accountId).executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new Error('账号不存在');
  }

  async updateLimitType(accountId: string, limitType: 'unknown' | 'weekly' | 'monthly'): Promise<void> {
    const result = await this.db.updateTable('account_operational_profiles').set({ limit_type: limitType })
      .where('account_id', '=', accountId).executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new Error('账号不存在');
  }
}

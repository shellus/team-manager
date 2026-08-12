import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { SecretCipher, type EncryptedValue } from '../secretCipher.js';

export class SettingsRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly cipher: SecretCipher
  ) {}

  async setValue(key: string, value: Record<string, unknown>): Promise<void> {
    await this.db.insertInto('system_settings').values({
      key: requireKey(key), value, is_secret: false,
      ciphertext: null, nonce: null, auth_tag: null, key_version: null
    }).onConflict((oc) => oc.column('key').doUpdateSet({
      value, is_secret: false, ciphertext: null, nonce: null, auth_tag: null, key_version: null
    })).execute();
  }

  async value(key: string): Promise<Record<string, unknown> | undefined> {
    const row = await this.db.selectFrom('system_settings').select(['value', 'is_secret']).where('key', '=', key).executeTakeFirst();
    if (!row) return undefined;
    if (row.is_secret) throw new Error(`设置 ${key} 是秘密，不能按普通设置读取`);
    return row.value;
  }

  async setSecret(key: string, plaintext: string): Promise<void> {
    const normalizedKey = requireKey(key);
    const encrypted = this.cipher.encrypt(plaintext, `system-setting:${normalizedKey}`);
    await this.db.insertInto('system_settings').values({
      key: normalizedKey, value: {}, is_secret: true,
      ciphertext: encrypted.ciphertext, nonce: encrypted.nonce,
      auth_tag: encrypted.authTag, key_version: encrypted.keyVersion
    }).onConflict((oc) => oc.column('key').doUpdateSet({
      value: {}, is_secret: true,
      ciphertext: encrypted.ciphertext, nonce: encrypted.nonce,
      auth_tag: encrypted.authTag, key_version: encrypted.keyVersion
    })).execute();
  }

  async secret(key: string): Promise<string | undefined> {
    const normalizedKey = requireKey(key);
    const row = await this.db.selectFrom('system_settings').selectAll().where('key', '=', normalizedKey).executeTakeFirst();
    if (!row) return undefined;
    if (!row.is_secret || !row.ciphertext || !row.nonce || !row.auth_tag || !row.key_version) {
      throw new Error(`设置 ${normalizedKey} 不是有效的加密秘密`);
    }
    return this.cipher.decrypt(toEncrypted({
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      auth_tag: row.auth_tag,
      key_version: row.key_version
    }), `system-setting:${normalizedKey}`);
  }

  async setNotificationPolicy(kind: string, enabled: boolean, configuration: Record<string, unknown>): Promise<void> {
    const normalizedKind = requireKey(kind);
    await this.db.insertInto('notification_policies').values({
      kind: normalizedKind, enabled, configuration
    }).onConflict((oc) => oc.column('kind').doUpdateSet({ enabled, configuration })).execute();
  }
}

function requireKey(value: string): string {
  const key = value.trim();
  if (!key || key.length > 200) throw new Error('设置键无效');
  return key;
}

function toEncrypted(row: { ciphertext: string; nonce: string; auth_tag: string; key_version: string }): EncryptedValue {
  return { ciphertext: row.ciphertext, nonce: row.nonce, authTag: row.auth_tag, keyVersion: row.key_version };
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface EncryptedValue {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
}

export class SecretCipher {
  readonly #key: Buffer;

  constructor(keyMaterial: string, readonly keyVersion: string) {
    this.#key = parseKey(keyMaterial);
  }

  encrypt(plaintext: string, context: string): EncryptedValue {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, nonce);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: this.keyVersion
    };
  }

  decrypt(value: EncryptedValue, context: string): string {
    if (value.keyVersion !== this.keyVersion) throw new Error(`不支持的加密密钥版本：${value.keyVersion}`);
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(value.nonce, 'base64'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8');
  }
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseKey(material: string): Buffer {
  const trimmed = material.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (key.length !== 32) throw new Error('配置 server.dataEncryptionKey 必须是 32 字节（64 位 hex 或 base64）');
  return key;
}

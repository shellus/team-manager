import type { Kysely } from 'kysely';
import { isResidentialProxySid, type ResidentialProxyConfig } from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import type { ResidentialProxyGateway } from '../residentialProxyGateway.js';
import type { AccountOperationalRepository } from '../repositories/accountOperationalRepository.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';
import { AccountRepository } from '../repositories/accountRepository.js';
import { ServiceError } from '../serviceError.js';

/** 账号住宅代理：配置保存在 Team Manager 账号上，由自有 Mihomo 网关按账号路由到住宅上游。 */
export class ResidentialProxyService {
  readonly #accounts: AccountRepository;
  readonly #activity: ActivityLogRepository;

  constructor(
    db: Kysely<Database>,
    private readonly operational: AccountOperationalRepository,
    private readonly gateway?: ResidentialProxyGateway
  ) {
    this.#accounts = new AccountRepository(db);
    this.#activity = new ActivityLogRepository(db);
  }

  async get(accountId: string): Promise<ResidentialProxyConfig | null> {
    await this.requireAccount(accountId);
    return await this.operational.residentialProxy(accountId) ?? null;
  }

  async set(accountId: string, input: ResidentialProxyConfig): Promise<ResidentialProxyConfig> {
    const gateway = this.requireGateway();
    await this.requireAccount(accountId);
    const config = normalizeResidentialProxy(input);
    await this.operational.setResidentialProxy(accountId, config);
    await gateway.sync({ closeAccountId: accountId });
    await this.#activity.log({ accountId, kind: 'residential_proxy_configured', payload: { ...config } });
    return config;
  }

  async clear(accountId: string): Promise<{ cleared: true }> {
    const gateway = this.requireGateway();
    await this.requireAccount(accountId);
    await this.operational.setResidentialProxy(accountId, null);
    await gateway.sync({ closeAccountId: accountId });
    await this.#activity.log({ accountId, kind: 'residential_proxy_cleared' });
    return { cleared: true };
  }

  /** 启动时按数据库重建网关配置，保证网关容器重建后立即可用。 */
  async syncGateway(): Promise<void> {
    await this.gateway?.sync();
  }

  private async requireAccount(accountId: string) {
    if (!await this.#accounts.findById(accountId)) throw new ServiceError(404, '账号不存在');
  }

  private requireGateway(): ResidentialProxyGateway {
    if (!this.gateway) throw new ServiceError(503, '住宅代理网关未配置');
    return this.gateway;
  }
}

export function normalizeResidentialProxy(input: Partial<ResidentialProxyConfig> | undefined): ResidentialProxyConfig {
  const sid = typeof input?.sid === 'string' ? input.sid.trim() : '';
  const country = typeof input?.country === 'string' ? input.country.trim().toUpperCase() : '';
  const asn = optionalText(input?.asn);
  const state = optionalText(input?.state);
  const city = optionalText(input?.city);
  if (!isResidentialProxySid(sid)) throw new ServiceError(400, '代理 SID 必须是 8 位字母或数字');
  if (!/^[A-Z]{2}$/.test(country)) throw new ServiceError(400, '代理国家必须是两个字母');
  if (asn && (state || city)) throw new ServiceError(400, 'ASN 与州/城市不能同时设置');
  if (city && !state) throw new ServiceError(400, '设置城市时必须同时设置州/省');
  for (const [label, value] of [['ASN', asn], ['州/省', state], ['城市', city]] as const) {
    if (value && !/^[\p{L}\p{N} ._']{1,64}$/u.test(value)) throw new ServiceError(400, `代理${label}包含无效字符`);
  }
  return { sid, country, asn, state, city };
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

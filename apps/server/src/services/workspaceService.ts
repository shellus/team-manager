import { UnifiedProjectionRepository } from '../repositories/unifiedProjectionRepository.js';
import { ServiceError } from '../serviceError.js';
import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';

export class WorkspaceService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly projections: UnifiedProjectionRepository
  ) {}

  async list(query?: string) {
    const items = await this.projections.workspaces(query);
    return items.map((item) => {
      const risks: string[] = [];
      if (item.status !== 'active') risks.push('Workspace 非活动');
      if (item.plan === 'unknown') risks.push('套餐未知');
      if (item.nextRenewalAt && new Date(item.nextRenewalAt).getTime() < Date.now()) risks.push('订阅已过期');
      else if (item.nextRenewalAt && new Date(item.nextRenewalAt).getTime() < Date.now() + 7 * 86400_000) risks.push('七天内续费');
      return { ...item, riskLevel: risks.some((risk) => risk.includes('过期')) ? 'critical' as const : risks.length ? 'warning' as const : 'normal' as const, risks };
    }).sort((a,b)=>riskRank(a.riskLevel)-riskRank(b.riskLevel)||(a.nextRenewalAt??'9999').localeCompare(b.nextRenewalAt??'9999'));
  }
  async detailForAccount(id: string, accountId: string) {
    const result = await this.projections.workspaceForAccount(id, accountId);
    if (!result) throw new ServiceError(404, '账号没有该 Workspace 成员关系');
    return result;
  }

  async setPreferredManager(id: string, viewerAccountId: string, preferredManagerAccountId: string) {
    await this.detailForAccount(id, viewerAccountId);
    const owner = await this.db.selectFrom('workspace_memberships')
      .select('id')
      .where('workspace_id', '=', id)
      .where('account_id', '=', preferredManagerAccountId)
      .where('status', '=', 'active')
      .where('normalized_role', '=', 'owner')
      .executeTakeFirst();
    if (!owner) throw new ServiceError(409, '首选管理账号必须是该 Workspace 当前有效的 owner');
    const updated = await this.db.updateTable('workspaces')
      .set({ preferred_manager_account_id: preferredManagerAccountId })
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw new ServiceError(404, 'Workspace 不存在');
    return this.detailForAccount(id, viewerAccountId);
  }
}
function riskRank(value:string){return value==='critical'?0:value==='warning'?1:value==='normal'?2:3;}

import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { UnifiedProjectionRepository } from '../repositories/unifiedProjectionRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { ServiceError, asServiceError } from '../serviceError.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';

export class WorkspaceService {
  readonly #workspaces: WorkspaceRepository;
  constructor(
    private readonly db: Kysely<Database>,
    private readonly projections: UnifiedProjectionRepository
  ) { this.#workspaces = new WorkspaceRepository(db); }

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
  async detail(id: string) {
    const result = await this.projections.workspace(id);
    if (!result) throw new ServiceError(404, 'Workspace 不存在');
    return result;
  }
  async requireExecutor(id: string, accountId: string) {
    try { await this.#workspaces.requireManageableBy(id, accountId); }
    catch (error) { throw asServiceError(error); }
  }
  activities(id: string, limit = 200) { return new ActivityLogRepository(this.db).list({ workspaceId: id, limit }); }
}
function riskRank(value:string){return value==='critical'?0:value==='warning'?1:value==='normal'?2:3;}

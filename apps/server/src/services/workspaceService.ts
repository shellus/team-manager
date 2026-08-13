import { UnifiedProjectionRepository } from '../repositories/unifiedProjectionRepository.js';
import { ServiceError } from '../serviceError.js';

export class WorkspaceService {
  constructor(private readonly projections: UnifiedProjectionRepository) {}

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
}
function riskRank(value:string){return value==='critical'?0:value==='warning'?1:value==='normal'?2:3;}

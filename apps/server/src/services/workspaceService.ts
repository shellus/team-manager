import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { UnifiedProjectionRepository } from '../repositories/unifiedProjectionRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { ServiceError, asServiceError } from '../serviceError.js';

export class WorkspaceService {
  readonly #workspaces: WorkspaceRepository;
  constructor(
    private readonly db: Kysely<Database>,
    private readonly projections: UnifiedProjectionRepository
  ) { this.#workspaces = new WorkspaceRepository(db); }

  list(query?: string) { return this.projections.workspaces(query); }
  async detail(id: string) {
    const result = await this.projections.workspace(id);
    if (!result) throw new ServiceError(404, 'Workspace 不存在');
    return result;
  }
  async requireExecutor(id: string, accountId: string) {
    try { await this.#workspaces.requireManageableBy(id, accountId); }
    catch (error) { throw asServiceError(error); }
  }
}

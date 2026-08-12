import type { Kysely } from 'kysely';
import type { Database } from '../database/schema.js';

export type BillingContext =
  | { kind: 'personal'; personalSpaceId: string }
  | { kind: 'workspace'; workspaceId: string };

export class BillingRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async saveSnapshot(context: BillingContext, payload: Record<string, unknown>, observedAt: Date | string): Promise<string> {
    const row = await this.db.insertInto('billing_snapshots').values({
      personal_space_id: context.kind === 'personal' ? context.personalSpaceId : null,
      workspace_id: context.kind === 'workspace' ? context.workspaceId : null,
      payload,
      observed_at: observedAt
    }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  latest(context: BillingContext) {
    let query = this.db.selectFrom('billing_snapshots').selectAll();
    query = context.kind === 'personal'
      ? query.where('personal_space_id', '=', context.personalSpaceId).where('workspace_id', 'is', null)
      : query.where('workspace_id', '=', context.workspaceId).where('personal_space_id', 'is', null);
    return query.orderBy('observed_at', 'desc').executeTakeFirst();
  }
}

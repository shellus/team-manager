import type { Kysely } from 'kysely';
import type { Database, SeatSlotRow } from '../database/schema.js';
import { normalizeEmail } from '../domain/identity.js';

export interface SaveSeatSlotInput {
  workspaceId: string;
  seatKey: string;
  email?: string | null;
  remoteUserId?: string | null;
  contact?: string | null;
  remark?: string | null;
  price?: string | null;
  expiresOn?: string | null;
  expireReminder?: boolean;
  expireRemove?: boolean;
  seatType: 'default' | 'usage_based';
  status: 'empty' | 'invited' | 'member' | 'unknown' | 'disabled';
}

export class SeatSlotRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async save(input: SaveSeatSlotInput): Promise<SeatSlotRow> {
    return this.db.insertInto('seat_slots').values({
      workspace_id: input.workspaceId,
      seat_key: input.seatKey,
      current_email: input.email?.trim() || null,
      remote_user_id: input.remoteUserId?.trim() || null,
      normalized_current_email: input.email ? normalizeEmail(input.email) : null,
      contact: input.contact?.trim() || null,
      remark: input.remark?.trim() || null,
      price: input.price?.trim() || null,
      expires_on: input.expiresOn ?? null,
      expire_reminder: input.expireReminder ?? false,
      expire_remove: input.expireRemove ?? false,
      seat_type: input.seatType,
      status: input.status
    }).onConflict((oc) => oc.column('seat_key').doUpdateSet({
      workspace_id: input.workspaceId,
      current_email: input.email?.trim() || null,
      remote_user_id: input.remoteUserId?.trim() || null,
      normalized_current_email: input.email ? normalizeEmail(input.email) : null,
      contact: input.contact?.trim() || null,
      remark: input.remark?.trim() || null,
      price: input.price?.trim() || null,
      expires_on: input.expiresOn ?? null,
      expire_reminder: input.expireReminder ?? false,
      expire_remove: input.expireRemove ?? false,
      seat_type: input.seatType,
      status: input.status
    })).returningAll().executeTakeFirstOrThrow();
  }

  findByPublicKey(seatKey: string): Promise<SeatSlotRow | undefined> {
    return this.db.selectFrom('seat_slots').selectAll().where('seat_key', '=', seatKey).executeTakeFirst();
  }
}

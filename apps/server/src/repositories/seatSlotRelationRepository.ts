import { isSeatType, type SeatSlotRelationStatus, type SeatType } from '@team-manager/shared';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../database/schema.js';
import { normalizeEmail } from '../domain/identity.js';

export interface SeatSlotRelation {
  status: SeatSlotRelationStatus;
  remoteUserId: string | null;
  seatType?: SeatType;
}

interface SeatIdentity {
  workspace_id: string;
  current_email: string | null;
  normalized_current_email?: string | null;
}

interface MembershipFact {
  workspace_id: string;
  normalized_email: string | null;
  account_email?: string | null;
  remote_user_id: string | null;
  seat_type: string | null;
  status: string;
}

interface InvitationFact {
  workspace_id: string;
  normalized_email: string;
  seat_type: string | null;
  status: string;
}

export class SeatSlotRelationRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async resolve(workspaceId: string, email: string | null | undefined): Promise<SeatSlotRelation> {
    if (!email) return emptyRelation();
    const normalized = normalizeEmail(email);
    const member = await this.db.selectFrom('workspace_memberships as membership')
      .leftJoin('accounts as account', 'account.id', 'membership.account_id')
      .select(['membership.remote_user_id', 'membership.seat_type'])
      .where('membership.workspace_id', '=', workspaceId)
      .where(sql<string>`coalesce(membership.normalized_email, account.normalized_email)`, '=', normalized)
      .where('membership.status', '=', 'active')
      .executeTakeFirst();
    if (member) return memberRelation(member);
    const invitation = await this.db.selectFrom('workspace_invitations')
      .select('seat_type')
      .where('workspace_id', '=', workspaceId)
      .where('normalized_email', '=', normalized)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return invitation ? invitationRelation(invitation) : unlinkedRelation();
  }
}

export function seatSlotRelationFromFacts(
  slot: SeatIdentity,
  memberships: MembershipFact[],
  invitations: InvitationFact[]
): SeatSlotRelation {
  if (!slot.current_email) return emptyRelation();
  const normalized = slot.normalized_current_email ?? normalizeEmail(slot.current_email);
  const member = memberships.find((item) => item.workspace_id === slot.workspace_id
    && (item.normalized_email ?? normalizeOptionalEmail(item.account_email)) === normalized && item.status === 'active');
  if (member) return memberRelation(member);
  const invitation = invitations.find((item) => item.workspace_id === slot.workspace_id
    && item.normalized_email === normalized && item.status === 'pending');
  return invitation ? invitationRelation(invitation) : unlinkedRelation();
}

function emptyRelation(): SeatSlotRelation {
  return { status: 'unclaimed', remoteUserId: null };
}

function unlinkedRelation(): SeatSlotRelation {
  return { status: 'unlinked', remoteUserId: null };
}

function memberRelation(row: { remote_user_id: string | null; seat_type: string | null }): SeatSlotRelation {
  return {
    status: 'member',
    remoteUserId: row.remote_user_id,
    ...(seatType(row.seat_type) ? { seatType: seatType(row.seat_type) } : {})
  };
}

function invitationRelation(row: { seat_type: string | null }): SeatSlotRelation {
  return {
    status: 'invited',
    remoteUserId: null,
    ...(seatType(row.seat_type) ? { seatType: seatType(row.seat_type) } : {})
  };
}

function seatType(value: string | null): SeatType | undefined {
  return isSeatType(value) ? value : undefined;
}

function normalizeOptionalEmail(value?: string | null): string | null {
  return value ? normalizeEmail(value) : null;
}

import type {
  AccountWorkspaceLinkView,
  WorkspaceDetailView,
  WorkspaceInvitationView,
  WorkspaceMembershipView,
  SeatSlotView,
} from "@team-manager/shared";

export type AccountWorkspacePersonRow = {
  kind: "member" | "invitation" | "customer";
  rowKey: string;
  id: string;
  email?: string;
  accountEmail?: string;
  remoteUserId?: string;
  displayName?: string;
  role?: WorkspaceMembershipView["role"];
  rawRole?: string;
  seatType?: WorkspaceMembershipView["seatType"];
  observedAt?: string;
  seatSlot?: SeatSlotView;
};

const CHILD_QUERY_KEYS = [
  "credentialsPage",
  "credentialsPageSize",
  "modal",
  "workspaceOrderMode",
  "operationId",
  "personId",
];

export function resolveAccountWorkspaceId(
  workspaces: AccountWorkspaceLinkView[],
  requested?: string | null,
): string | undefined {
  return workspaces.some((workspace) => workspace.id === requested)
    ? requested ?? undefined
    : workspaces[0]?.id;
}

export function selectAccountWorkspaceParams(
  params: URLSearchParams,
  workspaceId: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set("workspaceId", workspaceId);
  for (const key of CHILD_QUERY_KEYS) next.delete(key);
  return next;
}

export function resolveAccountWorkspaceParams(
  params: URLSearchParams,
  workspaceId: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set("workspaceId", workspaceId);
  return next;
}

export function accountWorkspacePeople(
  workspace?: Pick<WorkspaceDetailView, "members" | "invitations" | "seatSlots">,
): AccountWorkspacePersonRow[] {
  if (!workspace) return [];
  const remainingSlots = new Map(workspace.seatSlots.map((slot) => [slot.id, slot]));
  const takeSlot = (email?: string) => {
    const normalized = normalizeEmail(email);
    const match = [...remainingSlots.values()].find((slot) =>
      Boolean(normalized && normalizeEmail(slot.email) === normalized));
    if (match) remainingSlots.delete(match.id);
    return match;
  };
  const members = workspace.members.filter((member) => member.status === "active").map((member) => ({
    ...member,
    kind: "member" as const,
    rowKey: `member:${member.id}`,
    seatSlot: takeSlot(member.email ?? member.accountEmail),
  }));
  const invitations = workspace.invitations.filter((invitation) => invitation.status === "pending").map((invitation) => ({
    ...invitation,
    kind: "invitation" as const,
    rowKey: `invitation:${invitation.id}`,
    seatSlot: takeSlot(invitation.email),
  }));
  const customers = [...remainingSlots.values()].map((seatSlot) => ({
    kind: "customer" as const,
    rowKey: `customer:${seatSlot.id}`,
    id: seatSlot.id,
    email: seatSlot.email,
    seatType: seatSlot.seatType,
    seatSlot,
  }));
  return [...members, ...invitations, ...customers];
}

function normalizeEmail(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

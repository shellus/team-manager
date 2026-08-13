import type {
  AccountWorkspaceLinkView,
  WorkspaceDetailView,
  WorkspaceInvitationView,
  WorkspaceMembershipView,
} from "@team-manager/shared";

export type AccountWorkspacePersonRow =
  | ({ kind: "member"; rowKey: string } & WorkspaceMembershipView)
  | ({ kind: "invitation"; rowKey: string } & WorkspaceInvitationView);

const CHILD_QUERY_KEYS = [
  "peoplePage",
  "peoplePageSize",
  "credentialsPage",
  "credentialsPageSize",
  "modal",
  "operationId",
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

export function accountWorkspacePeople(
  workspace?: Pick<WorkspaceDetailView, "members" | "invitations">,
): AccountWorkspacePersonRow[] {
  if (!workspace) return [];
  return [
    ...workspace.members
      .filter((member) => member.status === "active")
      .map((member) => ({ ...member, kind: "member" as const, rowKey: `member:${member.id}` })),
    ...workspace.invitations
      .filter((invitation) => invitation.status === "pending")
      .map((invitation) => ({ ...invitation, kind: "invitation" as const, rowKey: `invitation:${invitation.id}` })),
  ];
}

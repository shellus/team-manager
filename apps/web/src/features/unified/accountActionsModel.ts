import type {
  PersonalPlan,
  PrimaryPlan,
  UnifiedAccountSummaryView,
} from "@team-manager/shared";

export type AccountActionModal =
  | "profile"
  | "proxy"
  | "subscription"
  | "session";

export type AccountActionSummary = UnifiedAccountSummaryView & {
  personalPlan?: PersonalPlan;
};

export const PRIMARY_PLAN_OPTIONS: ReadonlyArray<{
  value: PrimaryPlan;
  label: string;
}> = [
  { value: "free", label: "Free" },
  { value: "go", label: "Go" },
  { value: "plus", label: "Plus" },
  { value: "pro_5x", label: "Pro 5x" },
  { value: "pro_20x", label: "Pro 20x" },
  { value: "business_two_seat", label: "双席位" },
  { value: "business_usage_based", label: "0.52" },
  { value: "team_member", label: "Team 子号" },
  { value: "unknown", label: "未知" },
];

const PRIMARY_PLAN_LABEL = new Map(
  PRIMARY_PLAN_OPTIONS.map(({ value, label }) => [value, label]),
);

export function primaryPlanLabel(
  primaryPlan: PrimaryPlan,
): string {
  return PRIMARY_PLAN_LABEL.get(primaryPlan) ?? "未知";
}

export function accountRemarkLabel(remark?: string): string {
  return remark?.trim() || "—";
}

export function selectUpgradeableWorkspaces<
  T extends {
    manageable: boolean;
    membershipStatus: string;
    role: string;
  },
>(workspaces: readonly T[]): T[] {
  return workspaces.filter(
    (workspace) =>
      workspace.manageable &&
      workspace.membershipStatus === "active" &&
      (workspace.role === "owner" || workspace.role === "admin"),
  );
}

export function parseSessionEditorInput(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Session 必须是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

export type ProfileAction = "start" | "stop" | "pending";

export function profileAction(
  profileStatus: UnifiedAccountSummaryView["profileStatus"],
  hasRunningProfile: boolean,
): ProfileAction {
  if (profileStatus === "queued" || profileStatus === "stopping") return "pending";
  if (profileStatus === "running") return "stop";
  return hasRunningProfile ? "stop" : "start";
}

export function actionModalFromParams(
  params: URLSearchParams,
): AccountActionModal | undefined {
  const modal = params.get("modal");
  return modal === "profile" ||
    modal === "proxy" ||
    modal === "subscription" ||
    modal === "session"
    ? modal
    : undefined;
}

export function setAccountActionInParams(
  params: URLSearchParams,
  action?: AccountActionModal,
  accountId?: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (action) next.set("modal", action);
  else next.delete("modal");
  if (action && accountId) next.set("actionAccountId", accountId);
  else next.delete("actionAccountId");
  return next;
}

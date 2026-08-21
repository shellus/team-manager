import type {
  PersonalPlan,
  PrimaryPlan,
  UnifiedAccountSummaryView,
} from "@team-manager/shared";

export type AccountActionModal =
  | "proxy"
  | "subscription"
  | "edit";

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
  { value: "business_fixed_seat", label: "Business 固定席位" },
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
  return remark?.trim() || "";
}

export function accountDetailDescription(groupName: string, remark?: string): string {
  const normalizedRemark = accountRemarkLabel(remark);
  return `账号 · ${groupName}${normalizedRemark ? ` · 备注：${normalizedRemark}` : ""}`;
}

export function seatUsageColor(occupied: number, capacity?: number): "blue" | "gold" | "green" | "red" {
  if (capacity === undefined) return "blue";
  if (occupied < capacity) return "gold";
  return occupied === capacity ? "green" : "red";
}

export function lifecycleLabel(lifecycle?: UnifiedAccountSummaryView["primaryPlanLifecycle"]): string {
  if (!lifecycle) return "—";
  const label = lifecycle.kind === "renews" ? "续费" : lifecycle.kind === "expires" ? "到期" : lifecycle.kind === "expired" ? "已过期" : "有效至";
  return `${label} ${new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(lifecycle.at))}`;
}

export function operationStatusLabel(status: import("@team-manager/shared").AccountManagerOperationStatus): string {
  return ({ queued: "等待开始", running: "进行中", waiting_for_otp: "等待验证码", waiting_manual: "等待处理", succeeded: "已完成", failed: "失败", interrupted: "已中断" } as const)[status];
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

export function executeProfileAction(
  accountId: string,
  action: Exclude<ProfileAction, "pending">,
  commands: {
    start: (id: string) => Promise<unknown>;
    stop: (id: string) => Promise<unknown>;
  },
): Promise<unknown> {
  return action === "stop" ? commands.stop(accountId) : commands.start(accountId);
}

export function actionModalFromParams(
  params: URLSearchParams,
): AccountActionModal | undefined {
  const modal = params.get("modal");
  return modal === "proxy" ||
    modal === "subscription" ||
    modal === "edit"
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

import { describe, expect, test } from "vitest";
import type { NotificationDeliveryView } from "@team-manager/shared";
import {
  notificationDeliveryPresentation,
  normalizedArtifactParams,
  parseRrwebRecording,
  workspaceSettingsFormValues,
  workspaceSettingsPatch,
} from "./unifiedUiModels.js";

describe("workspace settings mapping", () => {
  test("maps real snake_case and nested beta settings without camelCase fallbacks", () => {
    expect(
      workspaceSettingsFormValues(
        {
          default_seat_type: "usage_based",
          workspace_referrals_enabled: false,
          auto_accept_requests: true,
          beta_settings: {
            personal_access_tokens: true,
            codex_device_code_auth: false,
            codex_remote_control: true,
          },
          defaultSeat: "default",
          automaticReloadEnabled: false,
        },
        "Team",
      ),
    ).toEqual({
      name: "Team",
      defaultSeat: "usage_based",
      workspaceReferralsEnabled: false,
      autoAcceptRequests: true,
      personalAccessTokensEnabled: true,
      codexDeviceCodeAuthEnabled: false,
      codexRemoteControlEnabled: true,
      codexLocalAccessEnabled: undefined,
      automaticReloadEnabled: undefined,
    });
  });

  test("keeps unknown values out of mutation payload", () => {
    expect(
      workspaceSettingsPatch({
        name: "Team",
        automaticReloadEnabled: undefined,
        codexRemoteControlEnabled: false,
      }),
    ).toEqual({ codexRemoteControlEnabled: false });
  });

  test("submits only values changed from the loaded snapshot", () => {
    expect(workspaceSettingsPatch({defaultSeat:"default",autoAcceptRequests:false,automaticReloadEnabled:true},{defaultSeat:"default",autoAcceptRequests:true,automaticReloadEnabled:true})).toEqual({autoAcceptRequests:false});
  });

  test("keeps Codex Local permission read-only",()=>{
    expect(workspaceSettingsPatch({codexLocalAccessEnabled:true},{})).toEqual({});
  });

  test("maps automatic reload only from an explicit independent snapshot", () => {
    expect(
      workspaceSettingsFormValues({ automatic_reload: { is_enabled: true } })
        .automaticReloadEnabled,
    ).toBe(true);
    expect(
      workspaceSettingsFormValues({ automaticReloadEnabled: false })
        .automaticReloadEnabled,
    ).toBeUndefined();
  });
});

describe("artifact URL and rrweb import", () => {
  test("keeps orphan and a restorable replay modal while removing invalid values", () => {
    expect(normalizedArtifactParams(new URLSearchParams("kind=orphan&status=pending_delete&modal=replay&artifactId=a")).toString()).toBe("kind=orphan&status=pending_delete&modal=replay&artifactId=a");
    expect(normalizedArtifactParams(new URLSearchParams("kind=unknown&status=orphan&modal=debug&artifactId=a")).toString()).toBe("");
  });

  test("accepts wrapped and raw rrweb events without exposing a JSON viewer", () => {
    expect(parseRrwebRecording('[{"timestamp":1}]')).toEqual([{ timestamp: 1 }]);
    expect(parseRrwebRecording('{"format":"team-manager-rrweb","events":[]}')).toEqual({ format: "team-manager-rrweb", events: [] });
    expect(() => parseRrwebRecording('{"events":"invalid"}')).toThrow("不是可回放");
  });
});

describe("notification retry state", () => {
  const delivery = (
    partial: Partial<NotificationDeliveryView>,
  ): NotificationDeliveryView => ({
    id: "delivery-1",
    kind: "webhook",
    status: "retrying",
    summaryText: "通知投递",
    attemptCount: 1,
    maxAttempts: 3,
    createdAt: "2026-08-13T00:00:00Z",
    ...partial,
  });

  test("allows an immediate retry while attempts remain", () => {
    expect(notificationDeliveryPresentation(delivery({})).canRetry).toBe(true);
  });

  test("does not expose an invalid retry after exhaustion", () => {
    expect(
      notificationDeliveryPresentation(
        delivery({ status: "exhausted", attemptCount: 3 }),
      ).canRetry,
    ).toBe(false);
  });
});

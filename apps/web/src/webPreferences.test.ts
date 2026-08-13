import { describe, expect, test } from "vitest";
import { normalizeWebPreferences, rememberedValues } from "./webPreferences.js";

describe("web preferences", () => {
  test("only enables explicitly true preferences", () => {
    expect(
      normalizeWebPreferences({
        rememberFormValues: true,
        autoRefreshOperations: "true",
      }),
    ).toEqual({
      rememberFormValues: true,
      autoRefreshOperations: false,
      rrwebEnabled: false,
    });
  });

  test("persists only explicit non-sensitive whitelist fields", () => {
    const value = {
      country: "US",
      currency: "USD",
      targetPlan: "plus",
      card: { number: "4242424242424242", cvc: "123" },
      session: '{"accessToken":"secret"}',
      credentialJson: '{"access_token":"secret"}',
    };
    expect(
      rememberedValues(value, ["country", "currency", "targetPlan"]),
    ).toEqual({
      country: "US",
      currency: "USD",
      targetPlan: "plus",
    });
  });
});

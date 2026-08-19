import { describe, expect, test } from "vitest";
import { ApiError, errorMessage } from "./api.js";

describe("API error presentation", () => {
  test("keeps useful messages for Error, strings, structured objects and empty reasons", () => {
    expect(errorMessage(new Error("上游拒绝请求"))).toBe("上游拒绝请求");
    expect(errorMessage("网络连接失败")).toBe("网络连接失败");
    expect(errorMessage({ detail: "token 已失效" })).toBe("token 已失效");
    expect(errorMessage({ code: "token_revoked" })).toBe('{"code":"token_revoked"}');
    expect(errorMessage(undefined, "刷新账单失败")).toBe("刷新账单失败");
  });

  test("keeps upstream status separate from Team Manager response status", () => {
    const error = new ApiError(502, "设置默认支付方式失败: HTTP 401", "/payment-methods/default", 401);
    expect(error.status).toBe(502);
    expect(error.upstreamStatus).toBe(401);
  });
});

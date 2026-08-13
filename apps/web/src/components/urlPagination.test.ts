import { describe, expect, test } from "vitest";
import { paginationState, updatedPaginationParams } from "./urlPagination.js";

describe("URL pagination", () => {
  test("reads valid pagination and rejects invalid values", () => {
    expect(paginationState(new URLSearchParams("page=3&pageSize=50"))).toEqual({
      current: 3,
      pageSize: 50,
    });
    expect(paginationState(new URLSearchParams("page=-1&pageSize=nope"))).toEqual({
      current: 1,
      pageSize: 10,
    });
  });

  test("writes both parameters without dropping existing filters", () => {
    expect(
      updatedPaginationParams(
        new URLSearchParams("query=paid"),
        "ordersPage",
        "ordersPageSize",
        4,
        20,
      ).toString(),
    ).toBe("query=paid&ordersPage=4&ordersPageSize=20");
  });
});

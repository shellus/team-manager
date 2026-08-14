import { describe, expect, test } from "vitest";
import {
  pageSizeStorageKey,
  paginationState,
  readPersistedPageSize,
  updatedPaginationParams,
  writePersistedPageSize,
} from "./urlPagination.js";

describe("URL pagination", () => {
  test("reads the page from URL and the page size from persistent state", () => {
    expect(paginationState(new URLSearchParams("page=3&pageSize=100"), 50)).toEqual({
      current: 3,
      pageSize: 50,
    });
    expect(paginationState(new URLSearchParams("page=-1&pageSize=100"), -1)).toEqual({
      current: 1,
      pageSize: 10,
    });
  });

  test("writes only the page and removes the old page-size parameter", () => {
    expect(
      updatedPaginationParams(
        new URLSearchParams("query=paid&ordersPageSize=100"),
        "ordersPage",
        4,
        "ordersPageSize",
      ).toString(),
    ).toBe("query=paid&ordersPage=4");
  });

  test("persists page size under a stable localStorage key", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    writePersistedPageSize(storage, "ordersPageSize", 50);

    expect(values.get(pageSizeStorageKey("ordersPageSize"))).toBe("50");
    expect(readPersistedPageSize(storage, "ordersPageSize", 10)).toBe(50);
    expect(readPersistedPageSize(storage, "missing", 20)).toBe(20);
  });
});

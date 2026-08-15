import { useEffect, useState } from "react";
import type { TablePaginationConfig } from "antd";
import { useSearchParams } from "react-router-dom";
import { productPageSizeChanger } from "../theme/uiPolicy.js";

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export interface UrlPaginationOptions {
  total: number;
  pageKey?: string;
  pageSizeStorageKey: string;
  defaultPageSize?: number;
}

export function useUrlPagination({
  total,
  pageKey = "page",
  pageSizeStorageKey,
  defaultPageSize = DEFAULT_PAGE_SIZE,
}: UrlPaginationOptions): TablePaginationConfig {
  const [params, setParams] = useSearchParams();
  const legacyPageSizeKey = `${pageKey}Size`;
  const [pageSize, setPageSize] = useState(() =>
    readPersistedPageSize(browserStorage(), pageSizeStorageKey, defaultPageSize),
  );
  const state = paginationState(params, pageSize, pageKey);
  const lastPage = Math.max(1, Math.ceil(total / state.pageSize));
  const current = total > 0 ? Math.min(state.current, lastPage) : state.current;

  useEffect(() => {
    if (current === state.current && !params.has(legacyPageSizeKey)) return;
    setParams(
      updatedPaginationParams(params, pageKey, current, legacyPageSizeKey),
      { replace: true },
    );
  }, [current, legacyPageSizeKey, pageKey, params, setParams, state.current]);

  return {
    current,
    pageSize: state.pageSize,
    total,
    showSizeChanger: productPageSizeChanger,
    pageSizeOptions: [...new Set([...PAGE_SIZE_OPTIONS, defaultPageSize, state.pageSize])].sort((a, b) => a - b),
    showTotal: (count) => `共 ${count} 条`,
    onChange: (nextPage, nextPageSize) => {
      const normalizedPageSize = Math.max(1, Math.trunc(nextPageSize));
      const pageSizeChanged = normalizedPageSize !== state.pageSize;
      if (pageSizeChanged) {
        setPageSize(normalizedPageSize);
        writePersistedPageSize(browserStorage(), pageSizeStorageKey, normalizedPageSize);
      }
      setParams(
        updatedPaginationParams(
          params,
          pageKey,
          pageSizeChanged ? 1 : nextPage,
          legacyPageSizeKey,
        ),
      );
    },
  };
}

export function paginationState(
  params: URLSearchParams,
  pageSize = DEFAULT_PAGE_SIZE,
  pageKey = "page",
) {
  return {
    current: positiveInteger(params.get(pageKey), 1),
    pageSize: positiveInteger(String(pageSize), DEFAULT_PAGE_SIZE),
  };
}

export function updatedPaginationParams(
  params: URLSearchParams,
  pageKey: string,
  page: number,
  pageSizeKey = "pageSize",
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(pageKey, String(Math.max(1, Math.trunc(page))));
  next.delete(pageSizeKey);
  return next;
}

export function readPersistedPageSize(
  storage: Pick<Storage, "getItem"> | undefined,
  storageKey: string,
  fallback = DEFAULT_PAGE_SIZE,
): number {
  try {
    return positiveInteger(storage?.getItem(pageSizeStorageKey(storageKey)) ?? null, fallback);
  } catch {
    return fallback;
  }
}

export function writePersistedPageSize(
  storage: Pick<Storage, "setItem"> | undefined,
  storageKey: string,
  pageSize: number,
): void {
  try {
    storage?.setItem(pageSizeStorageKey(storageKey), String(Math.max(1, Math.trunc(pageSize))));
  } catch {
    // localStorage 不可用时仍保留当前页面内的选择。
  }
}

export function pageSizeStorageKey(storageKey: string): string {
  return `team-manager.pagination.page-size.${storageKey}`;
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

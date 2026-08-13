import { useEffect } from "react";
import type { TablePaginationConfig } from "antd";
import { useSearchParams } from "react-router-dom";

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export interface UrlPaginationOptions {
  total: number;
  pageKey?: string;
  pageSizeKey?: string;
  defaultPageSize?: number;
}

export function useUrlPagination({
  total,
  pageKey = "page",
  pageSizeKey = "pageSize",
  defaultPageSize = DEFAULT_PAGE_SIZE,
}: UrlPaginationOptions): TablePaginationConfig {
  const [params, setParams] = useSearchParams();
  const state = paginationState(params, pageKey, pageSizeKey, defaultPageSize);
  const lastPage = Math.max(1, Math.ceil(total / state.pageSize));
  const current = total > 0 ? Math.min(state.current, lastPage) : state.current;

  useEffect(() => {
    if (current === state.current) return;
    setParams(
      updatedPaginationParams(params, pageKey, pageSizeKey, current, state.pageSize),
      { replace: true },
    );
  }, [current, pageKey, pageSizeKey, params, setParams, state.current, state.pageSize]);

  return {
    current,
    pageSize: state.pageSize,
    total,
    showSizeChanger: true,
    pageSizeOptions: [...new Set([...PAGE_SIZE_OPTIONS, defaultPageSize])].sort((a, b) => a - b),
    showTotal: (count) => `共 ${count} 条`,
    onChange: (nextPage, nextPageSize) => {
      setParams(
        updatedPaginationParams(
          params,
          pageKey,
          pageSizeKey,
          nextPage,
          nextPageSize,
        ),
      );
    },
  };
}

export function paginationState(
  params: URLSearchParams,
  pageKey = "page",
  pageSizeKey = "pageSize",
  defaultPageSize = DEFAULT_PAGE_SIZE,
) {
  return {
    current: positiveInteger(params.get(pageKey), 1),
    pageSize: positiveInteger(params.get(pageSizeKey), defaultPageSize),
  };
}

export function updatedPaginationParams(
  params: URLSearchParams,
  pageKey: string,
  pageSizeKey: string,
  page: number,
  pageSize: number,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(pageKey, String(Math.max(1, Math.trunc(page))));
  next.set(pageSizeKey, String(Math.max(1, Math.trunc(pageSize))));
  return next;
}

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

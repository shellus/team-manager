import { Pagination, type PaginationProps } from 'antd';

export interface ProductPaginationProps {
  pagination: PaginationProps;
  className?: string;
  hideWhenSinglePage?: boolean;
}

/**
 * 非 Table 场景统一使用的分页渲染器。
 * Table 继续直接接收 useUrlPagination 的返回值，两者共用同一套产品策略。
 */
export function ProductPagination({
  pagination,
  className,
  hideWhenSinglePage = true,
}: ProductPaginationProps) {
  const total = Number(pagination.total ?? 0);
  const pageSize = Number(pagination.pageSize ?? 10);
  if (hideWhenSinglePage && total <= pageSize) return null;
  return <Pagination {...pagination} className={className} />;
}

const recordSortCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export interface SortableRecordName {
  email: string;
  remark?: string;
  isBanned?: boolean;
}

export function compareRecordSortName(a: SortableRecordName, b: SortableRecordName): number {
  return Number(Boolean(a.isBanned)) - Number(Boolean(b.isBanned))
    || recordSortCollator.compare(a.remark || a.email, b.remark || b.email);
}

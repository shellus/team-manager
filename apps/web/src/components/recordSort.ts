const recordSortCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export interface SortableRecordName {
  email: string;
  remark?: string;
}

export function compareRecordSortName(a: SortableRecordName, b: SortableRecordName): number {
  return recordSortCollator.compare(a.remark || a.email, b.remark || b.email);
}

export function matchesKeywordQuery(values: unknown[], query: string): boolean {
  const terms = query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = values
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .join('\n')
    .toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

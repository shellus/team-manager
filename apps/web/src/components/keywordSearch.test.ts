import { describe, expect, it } from 'vitest';
import { matchesKeywordQuery } from './keywordSearch.js';

describe('matchesKeywordQuery', () => {
  it('matches every whitespace-separated term without changing CJK input', () => {
    expect(matchesKeywordQuery(['我的子号', 'child@example.com', '客户 A'], '我 客户')).toBe(true);
    expect(matchesKeywordQuery(['我的子号', 'child@example.com', '客户 A'], 'wo我')).toBe(false);
  });

  it('matches case-insensitively and ignores empty terms', () => {
    expect(matchesKeywordQuery(['Child@Example.com', 12], ' child   12 ')).toBe(true);
    expect(matchesKeywordQuery(['Child@Example.com'], 'missing')).toBe(false);
  });
});

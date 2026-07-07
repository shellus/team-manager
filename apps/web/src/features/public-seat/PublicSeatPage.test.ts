import { describe, expect, test } from 'vitest';
import type { SeatSlotSwapState } from '@team-manager/shared';
import { buildSwapHistoryItems, nextPublicSeatLoadError } from './PublicSeatPage.js';

describe('PublicSeatPage swap history', () => {
  test('shows every swap in newest-first order', () => {
    const first = createSwap('swap-1', 'old@example.com', 'new@example.com', 100);
    const second = createSwap('swap-2', 'new@example.com', 'next@example.com', 200);

    const items = buildSwapHistoryItems([first, second]);

    expect(items.map((item) => item.id)).toEqual(['swap-2', 'swap-1']);
    expect(items[0]?.title).toBe('new@example.com -> next@example.com');
    expect(items[0]?.statusText).toBe('成功');
    expect(items[1]?.title).toBe('old@example.com -> new@example.com');
    expect(items[1]?.steps[0]?.status).toBe('finish');
  });
});

describe('PublicSeatPage load error state', () => {
  test('keeps the swap failure visible when a follow-up reload succeeds', () => {
    expect(nextPublicSeatLoadError('换号失败', undefined, true)).toBe('换号失败');
    expect(nextPublicSeatLoadError('换号失败', new Error('重新加载失败'), true)).toBe('重新加载失败');
    expect(nextPublicSeatLoadError('旧错误', undefined, false)).toBe('');
  });
});

function createSwap(id: string, fromEmail: string, toEmail: string, startedAt: number): SeatSlotSwapState {
  return {
    id,
    status: 'succeeded',
    fromEmail,
    toEmail,
    startedAt,
    updatedAt: startedAt + 10,
    completedAt: startedAt + 10,
    steps: [
      {
        key: 'inviting_new_email',
        label: '正在添加新成员',
        status: 'done',
        message: toEmail,
        at: startedAt + 10
      }
    ]
  };
}

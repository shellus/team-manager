import type { AccountView } from '@team-manager/shared';
import { MAX_CHATGPT_SEATS } from '@team-manager/shared';
import { planLabel, roleLabel } from './labels.js';
import { WorkspaceListCard } from './WorkspaceListCard.js';

function formatAccountError(error: string): string {
  if (error.includes('<!doctype') || error.includes('Unexpected token')) {
    return '同步失败：ChatGPT 返回网页内容，请检查隧道或 token 状态。';
  }
  return error.length > 96 ? `${error.slice(0, 96)}...` : error;
}

export function AccountCard({
  account,
  selected,
  syncing,
  onSelect,
  onAskRemove
}: {
  account: AccountView;
  selected: boolean;
  syncing: boolean;
  onSelect: () => void;
  onAskRemove: () => void;
}) {
  const memberCount = account.membersCache ? account.membersCache.length : undefined;
  const seatCount = account.membersCache
    ? account.membersCache.filter((member) => member.seat === 'default').length
    : undefined;
  const atLimit = seatCount !== undefined && seatCount >= MAX_CHATGPT_SEATS;
  const status = account.status ?? 'unknown';
  const statusLabel =
    status === 'active' ? '正常' : status === 'invalid' ? '失效' : '待同步';
  const refreshedAt = account.lastRefreshAt
    ? new Date(account.lastRefreshAt).toLocaleString('zh-CN', { hour12: false })
    : '未同步';

  return (
    <WorkspaceListCard
      selected={selected}
      status={status}
      statusLabel={syncing ? '同步中' : statusLabel}
      title={account.label}
      subtitle={account.workspaceName ?? account.email}
      meta={[
        { content: planLabel(account.planType) },
        { content: roleLabel(account.role) },
        { content: `成员 ${memberCount ?? '暂无'}` },
        {
          content: (
            <>
              ChatGPT {seatCount ?? '暂无'} / {MAX_CHATGPT_SEATS}
              {atLimit && '（满）'}
            </>
          ),
          className: atLimit ? 'seat-warn' : undefined
        }
      ]}
      footnote={`上次同步：${refreshedAt}`}
      error={account.lastError && <span title={account.lastError}>{formatAccountError(account.lastError)}</span>}
      menu={
        <details className="card-menu" onClick={(event) => event.stopPropagation()}>
          <summary aria-label="更多操作">⋮</summary>
          <div className="menu-content">
            <button
              type="button"
              className="danger menu-danger"
              onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                onAskRemove();
              }}
            >
              删除母号
            </button>
          </div>
        </details>
      }
      onSelect={onSelect}
    />
  );
}

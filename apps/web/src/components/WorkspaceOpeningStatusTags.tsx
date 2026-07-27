import { Tag } from 'antd';

export function WorkspaceOpeningStatusTags({
  hasCodexSpace = false,
  hasTeamSubscription = false,
  hasPro5x = false
}: {
  hasCodexSpace?: boolean;
  hasTeamSubscription?: boolean;
  hasPro5x?: boolean;
}) {
  return (
    <>
      {hasCodexSpace && <Tag color="green">0.52</Tag>}
      {hasTeamSubscription && <Tag color="green">双席位</Tag>}
      {hasPro5x && <Tag color="purple">Pro 5x</Tag>}
    </>
  );
}

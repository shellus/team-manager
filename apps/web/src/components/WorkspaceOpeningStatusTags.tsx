import { Tag } from 'antd';

export function WorkspaceOpeningStatusTags({
  hasCodexSpace,
  hasTeamSubscription
}: {
  hasCodexSpace: boolean;
  hasTeamSubscription: boolean;
}) {
  return (
    <>
      {hasCodexSpace && <Tag color="green">0.52</Tag>}
      {hasTeamSubscription && <Tag color="green">双席位</Tag>}
    </>
  );
}

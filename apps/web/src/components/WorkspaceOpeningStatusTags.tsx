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
      {(hasCodexSpace || !hasTeamSubscription) && (
        <Tag color={hasCodexSpace ? 'green' : 'default'}>
          {hasCodexSpace ? '0.52' : '未开 0.52'}
        </Tag>
      )}
      <Tag color={hasTeamSubscription ? 'green' : 'default'}>
        {hasTeamSubscription ? '双席位' : '未开双席位'}
      </Tag>
    </>
  );
}

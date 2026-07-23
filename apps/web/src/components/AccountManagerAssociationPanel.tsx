import type { AccountManagerProfileView, ParentAccountManagerStatus } from '@team-manager/shared';
import { PlayCircleOutlined, PoweroffOutlined } from '@ant-design/icons';
import { Button, Descriptions, Empty, Space, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api.js';
import { WorkspaceOpeningStatusTags } from './WorkspaceOpeningStatusTags.js';

export function AccountManagerAssociationPanel({
  recordLabel,
  recordId,
  managedAccountEmail,
  status,
  loading = false
}: {
  recordLabel: '母号' | '子号';
  recordId?: string;
  managedAccountEmail?: string;
  status?: ParentAccountManagerStatus | null;
  loading?: boolean;
}) {
  const [profile, setProfile] = useState<AccountManagerProfileView | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileAction, setProfileAction] = useState<'start' | 'stop' | null>(null);
  const [profileError, setProfileError] = useState<string>();

  const requestProfile = useCallback(async () => {
    if (!recordId || !managedAccountEmail) return null;
    return recordLabel === '母号'
      ? await apiClient.getParentAccountProfile(recordId)
      : await apiClient.getSubaccountAccountProfile(recordId);
  }, [managedAccountEmail, recordId, recordLabel]);

  useEffect(() => {
    if (!recordId || !managedAccountEmail) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setProfileLoading(true);
    setProfileError(undefined);
    void requestProfile()
      .then((next) => {
        if (!cancelled && next) setProfile(next);
      })
      .catch((error) => {
        if (!cancelled) setProfileError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });
    return () => { cancelled = true; };
  }, [managedAccountEmail, recordId, requestProfile]);

  useEffect(() => {
    if (profile?.status !== 'queued' && profile?.status !== 'stopping') return;
    const timer = window.setInterval(() => {
      void requestProfile()
        .then((next) => { if (next) setProfile(next); })
        .catch((error) => {
          setProfileError(error instanceof Error ? error.message : String(error));
        });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [profile?.status, requestProfile]);

  const changeProfile = async (action: 'start' | 'stop') => {
    if (!recordId) return;
    setProfileAction(action);
    setProfileError(undefined);
    try {
      const next = recordLabel === '母号'
        ? action === 'start'
          ? await apiClient.startParentAccountProfile(recordId)
          : await apiClient.stopParentAccountProfile(recordId)
        : action === 'start'
          ? await apiClient.startSubaccountAccountProfile(recordId)
          : await apiClient.stopSubaccountAccountProfile(recordId);
      setProfile(next);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : String(error));
    } finally {
      setProfileAction(null);
    }
  };

  if (!managedAccountEmail) {
    return <Empty description={`该${recordLabel}独立录入，未关联 GPT Account Manager`} />;
  }

  return (
    <Space direction="vertical" size={12} className="panel-stack account-manager-association-panel">
      <Typography.Title level={5}>GPT Account Manager 关联</Typography.Title>
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="关联状态">
          <Tag color="blue">GAM</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="账号引用">
          <Typography.Text code copyable>{managedAccountEmail}</Typography.Text>
        </Descriptions.Item>
        {status && (
          <Descriptions.Item label="服务状态">
            <AccountManagerServiceState status={status} loading={loading} />
          </Descriptions.Item>
        )}
        {status?.managed && (
          <Descriptions.Item label="开通状态">
            <Space size={6} wrap>
              <WorkspaceOpeningStatusTags
                hasCodexSpace={status.hasCodexSpace}
                hasTeamSubscription={status.hasTeamSubscription}
              />
            </Space>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="Profile">
          <Space size={8} wrap>
            <AccountProfileState profile={profile} loading={profileLoading} />
            <Button
              size="small"
              icon={<PlayCircleOutlined />}
              loading={profileAction === 'start'}
              disabled={!recordId || profileLoading || profileAction !== null
                || profile?.status === 'queued' || profile?.status === 'running' || profile?.status === 'stopping'}
              onClick={() => void changeProfile('start')}
            >
              启动 Profile
            </Button>
            <Button
              size="small"
              icon={<PoweroffOutlined />}
              loading={profileAction === 'stop' || profile?.status === 'stopping'}
              disabled={!recordId || profileLoading || profileAction !== null
                || !profile || profile.status === 'stopped' || profile.status === 'failed'}
              onClick={() => void changeProfile('stop')}
            >
              关闭 Profile
            </Button>
          </Space>
          {profileError && (
            <Typography.Text className="account-profile-error" type="danger">
              {profileError}
            </Typography.Text>
          )}
        </Descriptions.Item>
        {profile?.profileId && (
          <Descriptions.Item label="运行 Profile ID">
            <Typography.Text code copyable>{profile.profileId}</Typography.Text>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="数据边界">
          Team Manager 仅保存业务所需的 Web Session；注册密码与 CloakBrowser Profile 由 GPT Account Manager 管理。
        </Descriptions.Item>
      </Descriptions>
    </Space>
  );
}

function AccountProfileState({
  profile,
  loading
}: {
  profile: AccountManagerProfileView | null;
  loading: boolean;
}) {
  if (loading && !profile) return <Tag color="processing">正在读取</Tag>;
  if (!profile || profile.status === 'stopped') return <Tag>未启动</Tag>;
  if (profile.status === 'queued') return <Tag color="processing">排队中</Tag>;
  if (profile.status === 'running') return <Tag color="success">运行中</Tag>;
  if (profile.status === 'stopping') return <Tag color="warning">关闭中</Tag>;
  return <Tag color="error">启动失败</Tag>;
}

function AccountManagerServiceState({
  status,
  loading
}: {
  status: ParentAccountManagerStatus;
  loading: boolean;
}) {
  if (loading) return <Tag color="processing">正在读取</Tag>;
  if (status.configured === false) return <Tag>未配置</Tag>;
  if (status.reachable === false) return <Tag color="error">服务不可用</Tag>;
  if (status.managed === false) return <Tag color="warning">账号引用未受管</Tag>;
  return <Tag color="success">可用</Tag>;
}

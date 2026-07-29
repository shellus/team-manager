import type {
  AccountManagerOperationView,
  AccountManagerProfileView,
  ParentAccountManagerStatus,
  SubaccountAccountManagerStatus
} from '@team-manager/shared';
import { ImportOutlined, PlayCircleOutlined, PoweroffOutlined } from '@ant-design/icons';
import { Button, Descriptions, Empty, Space, Tag, Typography } from 'antd';
import { useCallback, useRef, useState } from 'react';
import { apiClient } from '../api.js';
import { ResidentialProxyConfigurationPanel } from './ResidentialProxyConfigurationPanel.js';
import { WorkspaceOpeningStatusTags } from './WorkspaceOpeningStatusTags.js';

type AccountManagerAssociationStatus = {
  configured: boolean;
  reachable: boolean;
  managed: boolean;
  accountEmail?: string;
  hasCodexSpace?: boolean;
  hasTeamSubscription?: boolean;
  hasPro5x?: boolean;
  enrollmentOperation?: ParentAccountManagerStatus['enrollmentOperation'];
  error?: string;
};

export function AccountManagerAssociationPanel({
  recordLabel,
  recordId,
  managedAccountEmail,
  status,
  loading = false,
  onStatusChanged,
  onProfileChanged
}: {
  recordLabel: '母号' | '子号';
  recordId?: string;
  managedAccountEmail?: string;
  status?: AccountManagerAssociationStatus | null;
  loading?: boolean;
  onStatusChanged?:
    | ((status: ParentAccountManagerStatus) => void)
    | ((status: SubaccountAccountManagerStatus) => void);
  onProfileChanged?: (profile: AccountManagerProfileView) => void;
}) {
  const [profile, setProfile] = useState<AccountManagerProfileView | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileAction, setProfileAction] = useState<'start' | 'stop' | null>(null);
  const [profileError, setProfileError] = useState<string>();
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState<string>();
  const onProfileChangedRef = useRef(onProfileChanged);
  onProfileChangedRef.current = onProfileChanged;
  const effectiveManagedEmail = managedAccountEmail || (status?.managed ? status.accountEmail : undefined);

  const requestProfile = useCallback(async () => {
    if (!recordId || !effectiveManagedEmail) return null;
    return recordLabel === '母号'
      ? await apiClient.getParentAccountProfile(recordId)
      : await apiClient.getSubaccountAccountProfile(recordId);
  }, [effectiveManagedEmail, recordId, recordLabel]);

  const requestProxyConfig = useCallback(async () => {
    if (!recordId || !effectiveManagedEmail) throw new Error('该账号尚未关联 GPT Account Manager');
    return recordLabel === '母号'
      ? await apiClient.getParentAccountProxy(recordId)
      : await apiClient.getSubaccountAccountProxy(recordId);
  }, [effectiveManagedEmail, recordId, recordLabel]);

  const saveProxyConfig = useCallback(async (config: Parameters<
    typeof apiClient.updateParentAccountProxy
  >[1]) => {
    if (!recordId || !effectiveManagedEmail) throw new Error('该账号尚未关联 GPT Account Manager');
    return recordLabel === '母号'
      ? await apiClient.updateParentAccountProxy(recordId, config)
      : await apiClient.updateSubaccountAccountProxy(recordId, config);
  }, [effectiveManagedEmail, recordId, recordLabel]);

  const refreshProfile = async () => {
    setProfileLoading(true);
    setProfileError(undefined);
    try {
      const next = await requestProfile();
      if (next) {
        setProfile(next);
        onProfileChangedRef.current?.(next);
      }
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : String(error));
    } finally {
      setProfileLoading(false);
    }
  };

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
      onProfileChangedRef.current?.(next);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : String(error));
    } finally {
      setProfileAction(null);
    }
  };

  const enrollAccount = async () => {
    if (!recordId) return;
    setEnrollmentLoading(true);
    setEnrollmentError(undefined);
    try {
      if (recordLabel === '母号') {
        (onStatusChanged as ((status: ParentAccountManagerStatus) => void) | undefined)?.(
          await apiClient.manageParentAccount(recordId)
        );
      } else {
        (onStatusChanged as ((status: SubaccountAccountManagerStatus) => void) | undefined)?.(
          await apiClient.manageSubaccountAccount(recordId)
        );
      }
    } catch (error) {
      setEnrollmentError(error instanceof Error ? error.message : String(error));
    } finally {
      setEnrollmentLoading(false);
    }
  };

  if (!effectiveManagedEmail) {
    const operation = status?.enrollmentOperation;
    const operationActive = operation && [
      'queued', 'running', 'waiting_for_otp', 'waiting_manual'
    ].includes(operation.status);
    return (
      <Space direction="vertical" size={12} className="panel-stack account-manager-association-panel">
        <Empty description={`该${recordLabel}独立录入，未关联 GPT Account Manager`}>
          {recordId && (
            <Button
              type="primary"
              icon={<ImportOutlined />}
              loading={enrollmentLoading}
              disabled={loading || enrollmentLoading || Boolean(operationActive)
                || status?.configured === false}
              onClick={() => void enrollAccount()}
            >
              {operation?.status === 'failed' || operation?.status === 'interrupted'
                ? '重新纳入 GAM 管理'
                : '纳入 GAM 管理'}
            </Button>
          )}
        </Empty>
        {operation && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="纳管状态">
              <EnrollmentOperationState status={operation.status} />
            </Descriptions.Item>
            <Descriptions.Item label="当前进度">
              {operation.message || enrollmentPhaseLabel(operation.phase)}
            </Descriptions.Item>
          </Descriptions>
        )}
        {(enrollmentError || (operation && status?.error)) && (
          <Typography.Text type="danger">
            {enrollmentError || status?.error}
          </Typography.Text>
        )}
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={12} className="panel-stack account-manager-association-panel">
      <Typography.Title level={5}>GPT Account Manager 关联</Typography.Title>
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="关联状态">
          <Tag color="blue">GAM</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="账号引用">
          <Typography.Text code copyable>{effectiveManagedEmail}</Typography.Text>
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
                hasPro5x={status.hasPro5x === true}
              />
            </Space>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="Profile">
          <Space size={8} wrap>
            <AccountProfileState profile={profile} loading={profileLoading} />
            <Button
              size="small"
              icon={<ImportOutlined />}
              loading={profileLoading}
              disabled={!recordId || profileAction !== null}
              onClick={() => void refreshProfile()}
            >
              读取状态
            </Button>
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
      <ResidentialProxyConfigurationPanel
        loadConfig={requestProxyConfig}
        saveConfig={saveProxyConfig}
      />
    </Space>
  );
}

function enrollmentPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    profile_creating: '正在创建 GAM 隔离 Profile',
    login_opening: '正在打开 ChatGPT 登录页',
    session_bootstrap: '正在导入现有 Web Session',
    waiting_for_otp: '正在从 GongXi-Mail 读取验证码',
    cloak_challenge_rotating_ip: '遇到人机验证，正在更换住宅 IP',
    cloak_proxy_rotating_ip: '当前代理不可用，正在更换住宅 IP',
    cloak_challenge_waiting_manual: '等待在该账号自己的 GAM Profile 中完成人机验证',
    complete: '账号已纳入 GAM 管理',
    import_failed: '账号导入失败',
    operation_interrupted: '账号导入已中断'
  };
  return labels[phase] || phase;
}

function EnrollmentOperationState({
  status
}: {
  status: AccountManagerOperationView['status'];
}) {
  if (status === 'queued') return <Tag color="processing">等待执行</Tag>;
  if (status === 'running') return <Tag color="processing">正在登录</Tag>;
  if (status === 'waiting_for_otp') return <Tag color="warning">等待验证码</Tag>;
  if (status === 'waiting_manual') return <Tag color="warning">等待人工处理</Tag>;
  if (status === 'succeeded') return <Tag color="success">导入完成</Tag>;
  if (status === 'interrupted') return <Tag>已终止</Tag>;
  return <Tag color="error">导入失败</Tag>;
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
  status: AccountManagerAssociationStatus;
  loading: boolean;
}) {
  if (loading) return <Tag color="processing">正在读取</Tag>;
  if (status.configured === false) return <Tag>未配置</Tag>;
  if (status.reachable === false) return <Tag color="error">服务不可用</Tag>;
  if (status.managed === false) return <Tag color="warning">账号引用未受管</Tag>;
  return <Tag color="success">可用</Tag>;
}

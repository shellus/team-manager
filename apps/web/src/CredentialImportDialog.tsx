import { useEffect, useId, useState } from 'react';

function readStringField(payload: unknown, key: string): string {
  if (!payload || typeof payload !== 'object') return '';
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export function CredentialImportDialog({
  open,
  onClose,
  onSubmit
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const titleId = useId();
  const [raw, setRaw] = useState('');
  const [email, setEmail] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [planType, setPlanType] = useState('');
  const [fileName, setFileName] = useState('');
  const [groupName, setGroupName] = useState('默认号池');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRaw('');
    setEmail('');
    setWorkspaceId('');
    setPlanType('');
    setFileName('');
    setGroupName('默认号池');
    setError('');
    setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose, open]);

  if (!open) return null;

  const updateRaw = (value: string) => {
    setRaw(value);
    try {
      const payload = JSON.parse(value) as Record<string, unknown>;
      setEmail(readStringField(payload, 'email'));
      setWorkspaceId(readStringField(payload, 'account_id'));
      setPlanType(readStringField(payload, 'plan_type'));
    } catch {
      setEmail('');
      setWorkspaceId('');
      setPlanType('');
    }
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error('JSON 解析失败，请检查格式');
      }
      await onSubmit({
        credential: payload,
        ...(fileName.trim() ? { fileName: fileName.trim() } : {}),
        groupName: groupName.trim() || '默认号池'
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="modal-panel session-import-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <div>
            <h2 id={titleId}>导入 Codex 凭证</h2>
            <p>导入已有 CPA/Codex auth JSON，系统按 workspace 保存凭证，不会创建 Web session。</p>
          </div>
        </div>

        <label className="field">
          <span>Codex credential JSON</span>
          <textarea
            className="session-input"
            rows={12}
            value={raw}
            spellCheck={false}
            onChange={(event) => updateRaw(event.target.value)}
            placeholder="粘贴包含 email、account_id、access_token、refresh_token、id_token 的 Codex credential JSON"
          />
        </label>

        <div className="credential-preview-grid">
          <label className="field compact-field">
            <span>自定义文件名</span>
            <input
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              placeholder="例如 cpa-a-child.json"
            />
          </label>
          <label className="field compact-field">
            <span>CPA 号池</span>
            <input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="例如 CPA-A"
            />
          </label>
          <label className="field compact-field">
            <span>识别邮箱</span>
            <input value={email} readOnly placeholder="粘贴 JSON 后自动识别 email" />
          </label>
          <label className="field compact-field">
            <span>workspace account_id</span>
            <input value={workspaceId} readOnly placeholder="粘贴 JSON 后自动识别 account_id" />
          </label>
          <label className="field compact-field">
            <span>plan_type</span>
            <input value={planType} readOnly placeholder="可选" />
          </label>
        </div>

        {busy && (
          <div className="inline-progress">
            <div className="progress-track indeterminate">
              <div className="progress-fill" />
            </div>
            <span>正在导入 Codex 凭证</span>
          </div>
        )}
        {error && <div className="banner error">{error}</div>}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="primary" onClick={submit} disabled={busy || !raw.trim()}>
            {busy ? '导入中' : '导入凭证'}
          </button>
        </div>
      </section>
    </div>
  );
}

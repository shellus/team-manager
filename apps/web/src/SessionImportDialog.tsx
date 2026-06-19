import { useEffect, useId, useState } from 'react';
import { getChatGptSessionUserEmail } from '@team-manager/shared';

export function SessionImportDialog({
  open,
  title,
  description,
  submitLabel,
  busyLabel,
  onClose,
  onSubmit
}: {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  busyLabel: string;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const titleId = useId();
  const [raw, setRaw] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRaw('');
    setEmail('');
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
      setEmail(getChatGptSessionUserEmail(JSON.parse(value)) ?? '');
    } catch {
      setEmail('');
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
      await onSubmit(payload);
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
            <h2 id={titleId}>{title}</h2>
            <p>{description}</p>
          </div>
        </div>

        <label className="field">
          <span>Session JSON</span>
          <textarea
            className="session-input"
            rows={12}
            value={raw}
            spellCheck={false}
            onChange={(event) => updateRaw(event.target.value)}
            placeholder="粘贴 chatgpt.com session JSON，系统只读取 user.email、account.id、accessToken"
          />
        </label>

        <label className="field compact-field">
          <span>识别邮箱</span>
          <input value={email} readOnly placeholder="粘贴 JSON 后自动识别 user.email" />
        </label>

        {busy && (
          <div className="inline-progress">
            <div className="progress-track indeterminate">
              <div className="progress-fill" />
            </div>
            <span>{busyLabel}</span>
          </div>
        )}
        {error && <div className="banner error">{error}</div>}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="primary" onClick={submit} disabled={busy || !raw.trim()}>
            {busy ? '保存中' : submitLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

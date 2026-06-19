import { useEffect, useId, useState } from 'react';
import { getChatGptSessionUserEmail } from '@team-manager/shared';

export function LocalProfileDialog({
  open,
  title,
  description,
  initialLabel,
  submitLabel,
  busyLabel,
  onClose,
  onSubmit
}: {
  open: boolean;
  title: string;
  description: string;
  initialLabel: string;
  submitLabel: string;
  busyLabel: string;
  onClose: () => void;
  onSubmit: (payload: { label: string; session?: Record<string, unknown> }) => Promise<void>;
}) {
  const titleId = useId();
  const [label, setLabel] = useState(initialLabel);
  const [raw, setRaw] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel(initialLabel);
    setRaw('');
    setEmail('');
    setError('');
    setBusy(false);
  }, [initialLabel, open]);

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
    if (!value.trim()) {
      setEmail('');
      return;
    }
    try {
      setEmail(getChatGptSessionUserEmail(JSON.parse(value)) ?? '');
    } catch {
      setEmail('');
    }
  };

  const submit = async () => {
    const nextLabel = label.trim();
    if (!nextLabel) return;
    setBusy(true);
    setError('');
    try {
      let session: Record<string, unknown> | undefined;
      if (raw.trim()) {
        try {
          session = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          throw new Error('JSON 解析失败，请检查格式');
        }
      }
      await onSubmit(session ? { label: nextLabel, session } : { label: nextLabel });
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
      <section className="modal-panel local-profile-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>{description}</p>
          </div>
        </div>

        <label className="field">
          <span>本地备注名</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="用于本系统列表展示"
            autoFocus
          />
        </label>

        <label className="field">
          <span>新的 Session JSON</span>
          <textarea
            className="session-input"
            rows={8}
            value={raw}
            spellCheck={false}
            onChange={(event) => updateRaw(event.target.value)}
            placeholder="可留空。需要更换 session 时粘贴 chatgpt.com session JSON"
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
          <button className="primary" onClick={submit} disabled={busy || !label.trim()}>
            {busy ? '保存中' : submitLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

import { SearchOutlined } from '@ant-design/icons';
import { Input } from 'antd';
import { useEffect, useRef, useState, type CompositionEvent, type ChangeEvent } from 'react';

const DEFAULT_DEBOUNCE_MS = 250;

export function KeywordSearchInput({
  value,
  placeholder,
  ariaLabel,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  onSearchChange
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  debounceMs?: number;
  onSearchChange: (query: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<number>();
  const composingRef = useRef(false);
  const compositionCommitRef = useRef<string>();
  const committedRef = useRef(value);
  const onSearchChangeRef = useRef(onSearchChange);

  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  useEffect(() => {
    if (value === committedRef.current) return;
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    committedRef.current = value;
    setDraft(value);
  }, [value]);

  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
  }, []);

  const commit = (next: string) => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    committedRef.current = next;
    onSearchChangeRef.current(next);
  };

  const scheduleCommit = (next: string) => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => commit(next), debounceMs);
  };

  const changeDraft = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setDraft(next);
    if (composingRef.current) return;
    if (compositionCommitRef.current === next) {
      compositionCommitRef.current = undefined;
      return;
    }
    compositionCommitRef.current = undefined;
    scheduleCommit(next);
  };

  const finishComposition = (event: CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    const next = event.currentTarget.value;
    setDraft(next);
    compositionCommitRef.current = next;
    commit(next);
  };

  return (
    <Input
      allowClear
      className="pane-search"
      prefix={<SearchOutlined />}
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={draft}
      onChange={changeDraft}
      onCompositionStart={() => {
        composingRef.current = true;
        compositionCommitRef.current = undefined;
        if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      }}
      onCompositionEnd={finishComposition}
      onPressEnter={() => commit(draft)}
      onBlur={() => {
        if (!composingRef.current && draft !== committedRef.current) commit(draft);
      }}
    />
  );
}

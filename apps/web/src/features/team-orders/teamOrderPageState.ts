export type TeamOrderPageModal = '' | 'edit-maintenance' | 'remove-maintenance';

export interface TeamOrderPageModalState {
  modal: TeamOrderPageModal;
  target: string;
}

const MODALS = new Set<TeamOrderPageModal>(['', 'edit-maintenance', 'remove-maintenance']);

export function parseTeamOrderPageModalState(params: URLSearchParams): TeamOrderPageModalState {
  const rawModal = params.get('modal')?.trim() ?? '';
  const modal = MODALS.has(rawModal as TeamOrderPageModal) ? rawModal as TeamOrderPageModal : '';
  return {
    modal,
    target: modal ? params.get('target')?.trim() ?? '' : ''
  };
}

export function setTeamOrderPageModalState(
  params: URLSearchParams,
  modal: Exclude<TeamOrderPageModal, ''>,
  target: string
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set('modal', modal);
  next.set('target', target);
  return next;
}

export function clearTeamOrderPageModalState(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('modal');
  next.delete('target');
  return next;
}

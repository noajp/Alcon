// A Space's approval mode, as the settings screen speaks of it. The mode
// itself is policy the server reads (activity_spaces.approval_mode; the
// engine composes it over every verdict in _shared/approvalPolicy.ts) —
// this file is only the screen's vocabulary: the three modes in their
// display order, what each is called, and what each promises. The words
// are i18n keys, translated in appMessages.ts.

export type ApprovalMode = 'ask' | 'auto' | 'free';

export const APPROVAL_MODE_ORDER: readonly ApprovalMode[] = ['ask', 'auto', 'free'];

export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  ask: 'Ask every time',
  auto: 'Auto',
  free: 'Free action',
};

export const APPROVAL_MODE_DESCRIPTIONS: Record<ApprovalMode, string> = {
  ask: 'Every write asks for approval first. Standing rules and full delegation do not carry a call through, and nothing is offered as rememberable.',
  auto: 'Only a critical call asks — sending, paying, deleting, posting publicly. Everything else follows each connection’s own permissions and delegation.',
  free: 'Nothing asks. What would have asked runs anyway and is recorded as a policy approval, so the audit still shows what ran unasked. Unattended work — automations included — runs to the end.',
};

/** Pure. A stored value read as a mode; anything unknown is 'auto', the
 *  mode that changes nothing — the same fallback the engine uses. */
export function approvalModeOf(value: unknown): ApprovalMode {
  return value === 'ask' || value === 'free' ? value : 'auto';
}

/** One row of space_approval_mode_changes, as the history list reads it. */
export interface ApprovalModeChange {
  id: string;
  from_mode: string | null;
  to_mode: string;
  changed_by: string | null;
  created_at: string;
}

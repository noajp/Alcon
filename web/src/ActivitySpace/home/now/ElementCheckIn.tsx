'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { Loader2 } from 'lucide-react';
import type { ElementWithDetails } from '@/types/database';
import { fetchElementWithDetails } from '@/hooks/useSupabase';
import { useCurrentUserId } from '@/providers/authContext';
import {
  CHECK_IN_NEXT_MAX, CHECK_IN_NOTE_MAX, checkInElement,
} from '@/hooks/coordinationData';
import { Button } from '@/ui/button';
import { CONTROL, FONT, STATUS, STATUS_ORDER } from '@/shared/designTokens';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import {
  checkInAttempt, checkInBase, checkInChange, checkInFailure, hasNewerCheckInVersion,
  type CheckInAttempt, type CheckInBase, type CheckInDraft,
} from './checkInDraft';
import { clearPendingCheckIn, readPendingCheckIn, rememberPendingCheckIn, type PendingCheckIn } from './checkInPending';

const storageLimits = { noteMax: CHECK_IN_NOTE_MAX, nextMax: CHECK_IN_NEXT_MAX };

interface ElementCheckInProps {
  element: ElementWithDetails;
  onSaved: () => void;
  onCancel?: () => void;
}

// A new Element starts a new editor; background refreshes of the same one do not.
export function ElementCheckIn(props: ElementCheckInProps) {
  const userId = useCurrentUserId();
  return <CheckInSession key={`${userId}:${props.element.id}`} {...props} userId={userId} />;
}

function CheckInSession({ element, onSaved, onCancel, userId }: ElementCheckInProps & { userId: string | null }) {
  const { t } = useI18n();
  const fieldId = useId();
  const [base, setBase] = useState(() => checkInBase(element));
  const [draft, setDraft] = useState<CheckInDraft>({ status: null, next: null, note: '' });
  const [nextOpen, setNextOpen] = useState(false);
  const [busy, setBusy] = useState<'save' | 'review' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<CheckInBase | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [historyChanged, setHistoryChanged] = useState(false);
  const [checking, setChecking] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [needsClose, setNeedsClose] = useState(false);
  const attemptRef = useRef<CheckInAttempt | null>(null);
  const unconfirmedRef = useRef<CheckInAttempt | null>(null);
  const pendingRef = useRef<PendingCheckIn | null>(null);
  const busyRef = useRef(false);
  const savedRef = useRef(false);
  const mountedRef = useRef(true);
  const saveRef = useRef<HTMLButtonElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const restorePending = useCallback(() => {
    try {
      if (!userId) throw new Error(t('Sign in before updating this Element.'));
      const pending = readPendingCheckIn(window.sessionStorage, userId, element.id, storageLimits);
      if (pending) {
        pendingRef.current = pending;
        attemptRef.current = pending.attempt;
        unconfirmedRef.current = pending.attempt;
        setBase(pending.base);
        setDraft(pending.draft);
        setUnconfirmed(true);
        setLatest(null);
        setError(t('An earlier update needs confirmation. Retry it before editing. You can close safely and resume it here.'));
      }
      setStorageError(null);
    } catch (cause) {
      setStorageError(cause instanceof Error ? t(cause.message) : t('This browser could not restore the previous update. Try restoring it again.'));
    } finally { setChecking(false); }
  }, [element.id, userId, t]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) restorePending(); });
    return () => { active = false; };
  }, [restorePending]);

  const change = checkInChange(base, draft);
  const selectedStatus = draft.status ?? base.status;
  const approvalBlocked = base.approvalPending && change?.patch.status === 'done';
  const newerVersion = hasNewerCheckInVersion(element.updated_at, base.updatedAt);
  const showReview = !unconfirmed && !historyChanged && !checking && !storageError && (conflict || newerVersion);
  const disabled = !!busy || saved || checking || !!storageError;
  const writeLocked = unconfirmed || historyChanged;
  const canSave = !disabled && !historyChanged
    && (unconfirmed || (!!change && !conflict && !latest && !approvalBlocked));

  function edit(patch: Partial<CheckInDraft>) {
    if (busyRef.current || savedRef.current || unconfirmedRef.current) return;
    setDraft(current => ({ ...current, ...patch }));
    setError(null);
  }

  async function save() {
    const retry = unconfirmedRef.current;
    if (busyRef.current || savedRef.current || checking || storageError || (!retry && (!canSave || !change))) return;
    busyRef.current = true;
    setBusy('save');
    setError(null);
    let sent = false;
    try {
      if (!userId) throw new Error(t('Sign in before updating this Element.'));
      const attempt = retry ?? checkInAttempt(change!, attemptRef.current, () => crypto.randomUUID());
      attemptRef.current = attempt;
      const pending: PendingCheckIn = pendingRef.current ?? { version: 1, userId, base, draft, attempt };
      rememberPendingCheckIn(window.sessionStorage, pending, storageLimits);
      pendingRef.current = pending;
      sent = true;
      await checkInElement({ ...attempt.input, requestId: attempt.requestId });
      savedRef.current = true;
      try {
        clearPendingCheckIn(window.sessionStorage, pending, storageLimits);
        pendingRef.current = null;
      } catch {
        if (mountedRef.current) {
          setSaved(true);
          setNeedsClose(true);
          setError(t('Your update was saved, but this browser could not clear its retry record. You can close safely; reopening will check the same update.'));
        }
        return;
      }
    } catch (cause) {
      if (!sent) {
        if (mountedRef.current) setStorageError(cause instanceof Error ? t(cause.message) : t('This browser could not keep the update for a safe retry. No request was sent.'));
        return;
      }
      const failure = checkInFailure(cause, !!retry);
      if (failure === 'unconfirmed') {
        if (!mountedRef.current) return;
        unconfirmedRef.current = attemptRef.current;
        setUnconfirmed(true);
        setLatest(null);
        setError(t('The save result is unknown. Retry this update before editing. You can close safely and resume it here.'));
        requestAnimationFrame(() => saveRef.current?.focus());
        return;
      }
      try {
        if (pendingRef.current) clearPendingCheckIn(window.sessionStorage, pendingRef.current, storageLimits);
        pendingRef.current = null;
      } catch {
        if (mountedRef.current) setStorageError(t('The confirmed result could not be cleared from this browser. Restore the previous update before writing another one.'));
      }
      if (!mountedRef.current) return;
      unconfirmedRef.current = null;
      setUnconfirmed(false);
      attemptRef.current = null;
      if (failure === 'conflict') {
        setConflict(true);
        setLatest(null);
        setReviewed(false);
        setError(t('This Element changed while you were editing. Your update is still here. Review the latest version before saving.'));
        requestAnimationFrame(() => reviewRef.current?.focus());
      } else if (failure === 'permission') {
        setError(t('You no longer have permission to update this Element. Your draft is still here.'));
      } else if (failure === 'history_changed') {
        // The receipt proves the original update was saved. Its later-edited
        // history must never be recreated by silently sending a new request.
        savedRef.current = true;
        setHistoryChanged(true);
        setLatest(null);
        setError(t('This update was saved, but its history was later edited or removed. Close this update and review the shared history in Element details before writing another.'));
      } else if (failure === 'invalid') {
        setError(t('This update was rejected. Check the status and the length of your note or next step, then try again. Your draft is still here.'));
      } else {
        setError(t('This update was not saved. Your draft is still here. Check your changes and try again.'));
      }
      return;
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
    if (mountedRef.current) {
      setSaved(true);
      onSaved();
    }
  }

  async function reviewLatest() {
    if (busyRef.current || savedRef.current || unconfirmedRef.current) return;
    busyRef.current = true;
    setBusy('review');
    setError(null);
    setConflict(true);
    try {
      const current = await fetchElementWithDetails(base.id);
      if (!mountedRef.current) return;
      if (!current) {
        setLatest(null);
        setError(t('This Element is no longer available. Your draft is still here.'));
        return;
      }
      setLatest(checkInBase(current));
    } catch {
      if (mountedRef.current) setError(t('Could not load the latest version. Your draft is still here. Try again.'));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  }

  function useLatest() {
    if (!latest || busyRef.current || savedRef.current || unconfirmedRef.current) return;
    setBase(latest);
    setLatest(null);
    setConflict(false);
    setReviewed(true);
    setError(null);
    // Reconfirmation is a new operation even when the latest timestamp is unchanged.
    attemptRef.current = null;
    requestAnimationFrame(() => saveRef.current?.focus());
  }

  return (
    <form
      aria-label={t('Update {title}', { title: base.title })}
      aria-busy={!!busy}
      className={cn('min-w-0 space-y-3', FONT.base)}
      onClick={event => event.stopPropagation()}
      onSubmit={event => { event.preventDefault(); void save(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if ((!change || unconfirmedRef.current || storageError) && !busyRef.current) onCancel?.();
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          void save();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${fieldId}-status`} className={cn(FONT.sm, 'text-muted-foreground')}>{t('Status')}</label>
        <select
          id={`${fieldId}-status`}
          value={selectedStatus ?? ''}
          disabled={disabled || writeLocked}
          onChange={event => edit({ status: event.target.value as NonNullable<CheckInDraft['status']> })}
          className={cn('max-w-full rounded-md bg-transparent px-2 focus:bg-[var(--surface-strong)] disabled:opacity-50', CONTROL.height.md, FONT.base,
            selectedStatus ? STATUS[selectedStatus].textColor : 'text-muted-foreground')}
          aria-describedby={base.approvalPending ? `${fieldId}-approval` : undefined}
        >
          <option value="" disabled>{t('Not set')}</option>
          {STATUS_ORDER.map(status => (
            <option key={status} value={status} disabled={status === 'done' && base.approvalPending}>
              {t(STATUS[status].label)}
            </option>
          ))}
        </select>
      </div>

      {base.approvalPending && (
        <p id={`${fieldId}-approval`} className={cn(FONT.sm, 'text-muted-foreground')}>
          {t('Use Approval in the Element details to approve this work before marking it Done.')}
        </p>
      )}

      <div>
        <label htmlFor={`${fieldId}-note`} className="sr-only">{t('Update note (optional)')}</label>
        <textarea
          id={`${fieldId}-note`}
          rows={2}
          maxLength={CHECK_IN_NOTE_MAX}
          value={draft.note}
          onChange={event => edit({ note: event.target.value })}
          disabled={disabled}
          readOnly={writeLocked}
          placeholder={t('Share an update, if useful…')}
          className={cn('block w-full resize-y rounded-md bg-transparent p-2 placeholder:text-muted-foreground focus:bg-[var(--surface-raised)] disabled:opacity-50', FONT.base)}
        />
      </div>

      <div className="space-y-2">
        <Button type="button" variant="ghost" size="sm" align="start" disabled={disabled}
          aria-expanded={nextOpen} aria-controls={`${fieldId}-next-area`} onClick={() => setNextOpen(open => !open)}>
          <DisclosureTriangle open={nextOpen} />
          {t(draft.next !== null ? 'Next step · edited' : 'Next step')}
        </Button>
        {nextOpen && (
          <div id={`${fieldId}-next-area`}>
            <label htmlFor={`${fieldId}-next`} className="sr-only">{t('Next step (optional)')}</label>
            <textarea id={`${fieldId}-next`} rows={2} maxLength={CHECK_IN_NEXT_MAX}
              value={draft.next ?? base.next ?? ''} disabled={disabled} readOnly={writeLocked}
              onChange={event => edit({ next: event.target.value })}
              placeholder={t('What would move this forward?')}
              className={cn('block w-full resize-y rounded-md bg-transparent p-2 placeholder:text-muted-foreground focus:bg-[var(--surface-raised)] disabled:opacity-50', FONT.base)} />
          </div>
        )}
      </div>

      {showReview && !latest && (
        <div className="space-y-2">
          {!error && <p className={cn(FONT.sm, 'text-muted-foreground')}>{t('A newer version is available. Your draft has been kept.')}</p>}
          <Button ref={reviewRef} type="button" variant="secondary" disabled={disabled} onClick={() => void reviewLatest()}>
            {busy === 'review' && <Loader2 size={CONTROL.icon.sm} className="animate-spin" aria-hidden="true" />}
            {t('Review latest')}
          </Button>
        </div>
      )}

      {latest && (
        <div className="space-y-2 rounded-md bg-[var(--surface-raised)] p-3" aria-live="polite">
          <p className="font-medium">{t('Latest shared version')}</p>
          <p className="break-words">{latest.title}</p>
          <dl className={cn('space-y-2', FONT.sm)}>
            <div><dt className="text-muted-foreground">{t('Status')}</dt><dd>{t(latest.status ? STATUS[latest.status].label : 'Not set')}</dd></div>
            <div><dt className="text-muted-foreground">{t('Next step')}</dt><dd className="whitespace-pre-wrap break-words">{latest.next || t('No next step set')}</dd></div>
          </dl>
          <p className={cn(FONT.sm, 'text-muted-foreground')}>{t('Your edits above are kept. Continue with this version, then review your update before saving.')}</p>
          <Button type="button" variant="secondary" disabled={disabled} onClick={useLatest}>{t('Continue with this version')}</Button>
        </div>
      )}

      {error && <p role="alert" className={cn(FONT.sm, 'break-words text-[var(--status-danger)]')}>{error}</p>}
      {checking && <p role="status" className={cn(FONT.sm, 'text-muted-foreground')}>{t('Checking for an unfinished update…')}</p>}
      {storageError && (
        <div className="space-y-2">
          <p role="alert" className={cn(FONT.sm, 'break-words text-[var(--status-danger)]')}>{storageError}</p>
          <Button type="button" variant="secondary" disabled={!!busy} onClick={restorePending}>{t('Try restoring again')}</Button>
        </div>
      )}
      {reviewed && !showReview && !latest && !error && (
        <p role="status" className={cn(FONT.sm, 'text-muted-foreground')}>{t('Latest version loaded. Review your changes, then save.')}</p>
      )}
      {approvalBlocked && <p role="alert" className={cn(FONT.sm, 'text-[var(--status-danger)]')}>{t('Approval is still required. Choose another status to save this update.')}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn(FONT.sm, 'text-muted-foreground')} role={saved ? 'status' : undefined}>
          {t(saved ? 'Update saved.' : 'Saved updates appear in the shared history.')}
        </p>
        <div className="flex items-center gap-2">
          {onCancel && !historyChanged && !needsClose && <Button type="button" variant="ghost" disabled={!!busy} onClick={onCancel}>{t(unconfirmed ? 'Close, keep update' : 'Cancel')}</Button>}
          {historyChanged || needsClose ? <Button type="button" variant="secondary" onClick={onSaved}>{t('Close update')}</Button> : (
            <Button ref={saveRef} type="submit" variant="primary" size="md" disabled={!canSave} aria-keyshortcuts="Control+Enter Meta+Enter">
              {busy === 'save' && <Loader2 size={CONTROL.icon.md} className="animate-spin" aria-hidden="true" />}
              {t(busy === 'save' ? 'Saving…' : unconfirmed ? 'Retry this update' : 'Save update')}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

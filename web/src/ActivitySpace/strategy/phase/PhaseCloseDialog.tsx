'use client';

// Closing a Phase — the one moment the board asks what the time box actually
// bought, and where the work that did not fit is going.
//
// Two things are deliberately not automatic here. The closing note is free
// text, not a pair of radio buttons reading "achieved" / "ran out of time",
// because the interesting closes are neither: four Elements unfinished at the
// end of Q3 because the CEO moved the date three weeks is a Phase that closed
// exactly on plan, and no enum can say that. And unfinished Elements have no
// default destination — a box that empties itself into the next round is a
// broken instrument.

import { useMemo, useState } from 'react';

import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { CARRY_OVER_REASON_PREFIX, closePhase, createElementComment, invalidateCarryOverReasons, type Phase } from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { formatDisplayName, getCachedDisplayNames } from '@/Function/settings/preferencesStore';
import {
  planPhaseClose,
  phaseRollup,
  unfinishedIn,
  type CloseDestination,
  type PhaseElementRow,
} from './phaseClose';

/** Mounted only while the dialog is open, so every field starts fresh. */
export function PhaseCloseDialog({
  phase,
  nextPhase,
  elements,
  onDismiss,
  onClosed,
}: {
  phase: Phase;
  /** Where "carry over" would send the work, or null when this is the last open Phase. */
  nextPhase: Phase | null;
  /** Every Element of the Domain; the rollup picks out this Phase's own. */
  elements: readonly (PhaseElementRow & { title: string })[];
  onDismiss: () => void;
  onClosed: () => void;
}) {
  const { user, profile } = useAuthContext();
  const { t } = useI18n();

  // The note a previous close left behind is the draft for this one.
  const [note, setNote] = useState(phase.closing_note ?? '');
  const [destination, setDestination] = useState<CloseDestination | null>(null);
  // Per-Element, and only meaningful for 'carry' — optional, keyed by Element
  // id so a blank entry writes nothing (el_STR-019: forcing one on every row
  // is exactly the "closing gets heavier" failure mode to avoid).
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const rollup = useMemo(() => phaseRollup(elements, phase.id), [elements, phase.id]);
  const unfinished = useMemo(() => unfinishedIn(elements, phase.id), [elements, phase.id]);

  const needsDestination = unfinished.length > 0;
  const canClose = !saving && (!needsDestination || destination !== null);

  const handleClose = async () => {
    if (!canClose) return;
    setSaving(true);
    setFailure(null);
    try {
      await closePhase(phase.id, {
        closingNote: note,
        elementWrites: planPhaseClose({
          elements,
          phaseId: phase.id,
          destination: destination ?? 'keep',
          nextPhaseId: nextPhase?.id ?? null,
        }),
      });
      // Best-effort, after the close: a Phase that closed correctly should
      // not read as failed because one annotation didn't save. Scoped to
      // 'carry' only — 'unassign'/'keep' don't produce the ↺N badge this
      // explains.
      if (destination === 'carry' && nextPhase) {
        const authorName = formatDisplayName(profile?.display_name, user?.email, getCachedDisplayNames());
        await Promise.allSettled(
          unfinished.map((el) => {
            const reason = reasons[el.id]?.trim();
            if (!reason) return Promise.resolve();
            return createElementComment({
              element_id: el.id,
              author_id: user?.id ?? null,
              author_kind: 'human',
              author_name: authorName,
              content: `${CARRY_OVER_REASON_PREFIX}${reason}`,
            }).catch((e) => console.error('Failed to record carry-over reason', el.id, e));
          }),
        );
        // Whatever Phase view opens next queries by its own Element id set,
        // which this dialog can't predict — without this, a view already
        // rendered once inside the default staleTime keeps showing the
        // pre-write (missing, or previous-round) reason.
        invalidateCarryOverReasons();
      }
      onDismiss();
      onClosed();
    } catch (e) {
      console.error('Failed to close Phase', e);
      setFailure(t('Could not close this Phase. It is still open, so closing again finishes what did not get through.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onDismiss(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Close {name}', { name: phase.name })}</DialogTitle>
          <DialogDescription>
            {rollup.total === 0
              ? t('No Elements were assigned to this Phase.')
              : t('{done} of {total} Elements done.', { done: rollup.done, total: rollup.total })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <label htmlFor="phase-closing-note" className="text-[12px] font-medium text-foreground">
            {t('Closing note')}
          </label>
          <p className="text-[12px] text-muted-foreground">
            {t('What did closing mean — got what it was for, or ran out of time? If unfinished work was a decision rather than a slip, this is where that is written down.')}
          </p>
          <textarea
            id="phase-closing-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoFocus
            placeholder={t('Achieved what it was for — or out of time. Say which, and why.')}
            className="w-full resize-none rounded-md px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground outline-none transition-[color,background-color] focus:bg-[var(--accent-subtle)]"
          />
        </div>

        {needsDestination && (
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-foreground">
              {unfinished.length === 1
                ? t('1 Element is not done. Where does it go?')
                : t('{n} Elements are not done. Where do they go?', { n: unfinished.length })}
            </span>
            <DestinationChoice
              value={destination}
              onChange={setDestination}
              option="carry"
              label={nextPhase ? t('Carry over to {name}', { name: nextPhase.name }) : t('Carry over to the next Phase')}
              hint={
                nextPhase
                  ? t('Moves them forward and counts the round they just spent here.')
                  : t('No later Phase to carry into.')
              }
              disabled={!nextPhase}
            />
            <DestinationChoice
              value={destination}
              onChange={setDestination}
              option="unassign"
              label={t('Take out of this Phase')}
              hint={t('They keep their owners and dates, but belong to no Phase.')}
            />
            <DestinationChoice
              value={destination}
              onChange={setDestination}
              option="keep"
              label={t('Leave them here')}
              hint={t('They stay in this Phase, unfinished, on the record.')}
            />
          </div>
        )}

        {destination === 'carry' && nextPhase && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-foreground">{t('Why, for each (optional)')}</span>
            <p className="text-[12px] text-muted-foreground">
              {t('The count on a carried Element says how many rounds, not why. A word here is the difference between “always meant to land next round” and “someone else’s work spilled onto this.”')}
            </p>
            <div className="flex flex-col gap-1.5">
              {unfinished.map((el) => (
                <div key={el.id} className="flex items-center gap-2">
                  <span className="text-[12px] text-foreground truncate flex-1 min-w-0">{el.title}</span>
                  <input
                    type="text"
                    value={reasons[el.id] ?? ''}
                    onChange={(e) => setReasons((prev) => ({ ...prev, [el.id]: e.target.value }))}
                    placeholder={t('Reason (optional)')}
                    className="w-[55%] shrink-0 rounded-md px-2 py-1 text-[12px] text-foreground placeholder:text-muted-foreground outline-none transition-[color,background-color] focus:bg-[var(--accent-subtle)]"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {failure && <p className="text-[12px] text-[var(--status-danger)]">{failure}</p>}

        <DialogFooter>
          <Button variant="ghost" size="md" onClick={onDismiss} disabled={saving}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" size="md" onClick={() => void handleClose()} disabled={!canClose}>
            {saving ? t('Closing…') : t('Close Phase')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DestinationChoice({
  value,
  onChange,
  option,
  label,
  hint,
  disabled,
}: {
  value: CloseDestination | null;
  onChange: (v: CloseDestination) => void;
  option: CloseDestination;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors ${
        disabled ? 'opacity-50' : 'cursor-pointer hover:bg-[var(--surface-strong)]'
      }`}
    >
      <input
        type="radio"
        name="phase-close-destination"
        checked={value === option}
        disabled={disabled}
        onChange={() => onChange(option)}
        className="mt-0.5 accent-[var(--accent-default)]"
      />
      <span className="min-w-0">
        <span className="block text-[13px] text-foreground">{label}</span>
        <span className="block text-[12px] text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

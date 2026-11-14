'use client';

import { formatDateTime } from '@/Function/shared/dateUtils';
import { formatError } from '@/Function/shared/formatError';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SegmentedRow, SettingsIsland } from '@/Function/settings/SettingsControls';
import { setSpaceApprovalMode, useSpaceApprovalMode } from './approvalModeData';
import { APPROVAL_MODE_DESCRIPTIONS, APPROVAL_MODE_LABELS, APPROVAL_MODE_ORDER, approvalModeOf, type ApprovalMode } from './approvalModeModel';

/** The Space's approval mode: how Athena's writes are held. A policy
 *  layer above every connection's own permissions and delegation — it
 *  changes how an ask is handled, never what is allowed (a "Not allowed"
 *  command stays refused in every mode, and a connection's test, its
 *  secret and a drafted connection's activation never read it). Owners
 *  change it through the one RPC, which records the change; a run keeps
 *  the mode it started under, and what already waits is never approved
 *  by a change. Under Free action, what would have asked runs and is
 *  recorded as a policy approval instead.
 *
 *  Presentation (settings redesign PR3): the three modes are segments —
 *  every choice visible at once — and the selected mode's own words sit
 *  in the row's caption slot, where state belongs. The data layer is
 *  untouched; only the control changed. */
export function ApprovalModeSection({ spaceId, isOwner }: { spaceId: string; isOwner: boolean }) {
  const { t } = useI18n();
  const { mode, changes, loading, error, refetch } = useSpaceApprovalMode(spaceId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const choose = async (next: ApprovalMode) => {
    if (!isOwner || saving || !mode || next === mode) return;
    setSaving(true); setSaveError(null);
    try {
      await setSpaceApprovalMode(spaceId, next);
      await refetch();
    } catch (e) {
      setSaveError(formatError(e));
    } finally {
      setSaving(false);
    }
  };

  // The caption is the row's state: what the selected mode promises,
  // then the transient and gating facts that belong to this row.
  const caption = mode
    ? [
        t(APPROVAL_MODE_DESCRIPTIONS[mode]),
        saving ? t('Saving…') : null,
        !isOwner ? t('Only Space owners can change the approval mode.') : null,
      ].filter(Boolean).join(' ')
    : undefined;

  return (
    <SettingsIsland title={t('Approval mode')}>
      {error ? (
        <p className="px-5 py-3.5 text-[12px] text-[var(--status-danger)]">{t("Couldn't load the approval mode: {error}", { error: error.message })}</p>
      ) : loading || !mode ? (
        <p className="px-5 py-3.5 text-[12px] text-muted-foreground">{t('Loading…')}</p>
      ) : (
        <>
          <SegmentedRow
            label={t('Approval mode')}
            desc={t('How the AI’s writes in this Space are held, above each connection’s own permissions. A run keeps the mode it started under; changing the mode never approves what already waits.')}
            caption={caption}
            value={APPROVAL_MODE_LABELS[mode]}
            options={APPROVAL_MODE_ORDER.map((m) => APPROVAL_MODE_LABELS[m])}
            onChange={(label) => {
              const next = APPROVAL_MODE_ORDER.find((m) => APPROVAL_MODE_LABELS[m] === label);
              if (next) void choose(next);
            }}
            disabled={!isOwner || saving}
          />
          {saveError && (
            <p role="alert" className="px-5 py-3 text-[12px] text-[var(--status-danger)]">{t("Couldn't change the approval mode: {error}", { error: saveError })}</p>
          )}
        </>
      )}
      {changes.length > 0 && (
        <div className="px-5 py-3.5">
          <button
            type="button"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[13px] font-medium text-foreground"
          >
            {historyOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {t('Approval mode history')}
          </button>
          {historyOpen && (
            <ul className="mt-2 space-y-1">
              {changes.slice(0, 5).map((c) => (
                <li key={c.id} className="text-[12px] text-muted-foreground">
                  {formatDateTime(c.created_at)} — {t(APPROVAL_MODE_LABELS[approvalModeOf(c.from_mode)])} → {t(APPROVAL_MODE_LABELS[approvalModeOf(c.to_mode)])}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SettingsIsland>
  );
}

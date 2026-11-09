'use client';

import { formatError } from '@/Function/shared/formatError';
import { useState } from 'react';
import { FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
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
 *  recorded as a policy approval instead. */
export function ApprovalModeSection({ spaceId, isOwner }: { spaceId: string; isOwner: boolean }) {
  const { t } = useI18n();
  const { mode, changes, loading, error, refetch } = useSpaceApprovalMode(spaceId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  return (
    <section className="space-y-3">
      <div>
        <h3 className={FONT.label}>{t('Approval mode')}</h3>
        <p className="mt-1 max-w-xl text-[12px] text-muted-foreground">
          {t('How the AI’s writes in this Space are held, above each connection’s own permissions. A run keeps the mode it started under; changing the mode never approves what already waits.')}
        </p>
      </div>
      {error ? (
        <p className="text-[12px] text-[var(--status-danger)]">{t("Couldn't load the approval mode: {error}", { error: error.message })}</p>
      ) : loading || !mode ? (
        <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <select value={mode} disabled={!isOwner || saving} onChange={(e) => void choose(e.target.value as ApprovalMode)}
              aria-label={t('Approval mode')}
              className="rounded border border-border/60 bg-transparent px-1 py-0.5 text-[13px] text-foreground">
              {APPROVAL_MODE_ORDER.map((m) => <option key={m} value={m}>{t(APPROVAL_MODE_LABELS[m])}</option>)}
            </select>
            {saving && <span className="text-[12px] text-muted-foreground">{t('Saving…')}</span>}
          </div>
          <p className="max-w-xl text-[12px] text-muted-foreground">{t(APPROVAL_MODE_DESCRIPTIONS[mode])}</p>
          {!isOwner && (
            <p className="text-[12px] text-muted-foreground">{t('Only Space owners can change the approval mode.')}</p>
          )}
          {saveError && (
            <p className="text-[12px] text-[var(--status-danger)]">{t("Couldn't change the approval mode: {error}", { error: saveError })}</p>
          )}
        </div>
      )}
      {changes.length > 0 && (
        <div>
          <h4 className={FONT.label}>{t('Approval mode history')}</h4>
          <ul className="mt-1 space-y-1">
            {changes.slice(0, 5).map((c) => (
              <li key={c.id} className="text-[12px] text-muted-foreground">
                {new Date(c.created_at).toLocaleString()} — {t(APPROVAL_MODE_LABELS[approvalModeOf(c.from_mode)])} → {t(APPROVAL_MODE_LABELS[approvalModeOf(c.to_mode)])}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

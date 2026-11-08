'use client';

import { useState } from 'react';
import { KeyRound, RefreshCw } from '@/ui/icons';
import { Button } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { ToolPage, type ToolView } from '@/Function/shared/tool/ToolPage';
import { useI18n } from '@/Function/i18n/I18nProvider';
import {
  CREDENTIAL_EVENT_LABEL, CREDENTIAL_EVENT_TONE, filterCredentialHistory,
  type CredentialHistoryFilter, type CredentialHistoryRow,
} from '@/Function/audit/credentialHistoryModel';
import { CREDENTIAL_HISTORY_LIMIT, useCredentialHistory } from '@/hooks/useCredentialUses';
import { Empty } from './auditParts';

// The credential history (secure-login PR4): the Audit app's place
// for the credential trail — every touch of a credential in this
// Space, newest first: stored, replaced and deleted by a person;
// used by a run; refused at a runner's gate or proven bad. The
// trail is append-only and value-free by construction, and its RLS
// is owners-only, so this page is the owners' review surface: a
// member reads an empty history, and the view's own words say
// whose read this is. A row that names a run opens that run in the
// log — the spend's story continues there.

const VIEWS: readonly ToolView[] = [
  { id: 'all', label: 'Credential history', icon: KeyRound, description: 'Every touch of a credential in this Space, newest first — what was stored, replaced, deleted, used and refused. The values themselves are never recorded. Only Space owners can read this history.' },
];

const FILTERS: readonly { id: CredentialHistoryFilter; label: string; empty: string }[] = [
  { id: 'all', label: 'All events', empty: 'No credential activity yet.' },
  { id: 'used', label: 'Uses', empty: 'No credential uses yet.' },
  { id: 'changes', label: 'Changes', empty: 'No credential changes yet.' },
  { id: 'problems', label: 'Problems', empty: 'No credential problems recorded.' },
];

function rowTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** One touch of a credential: when, what happened, which credential,
 *  and the person or the outcome behind it. A row a run spent opens
 *  the run; a lifecycle row is a record, not a door. */
function CredentialRow({ row, onOpenRun }: { row: CredentialHistoryRow; onOpenRun: (runId: string) => void }) {
  const { t, locale } = useI18n();
  const body = (
    <>
      <span className={`${FONT.sm} tabular-nums text-muted-foreground`}>{rowTime(row.at, locale)}</span>
      <span className="min-w-0">
        <span className={`${FONT.base} block truncate ${CREDENTIAL_EVENT_TONE[row.event]}`}>{t(CREDENTIAL_EVENT_LABEL[row.event])}</span>
        <span className={`${FONT.sm} block truncate text-muted-foreground`}>{row.credentialLabel}</span>
      </span>
      <span className={`${FONT.sm} truncate text-muted-foreground`}>
        {[row.origin, row.detailLabel ? t(row.detailLabel) : null, row.actorName].filter(Boolean).join(' · ')}
      </span>
      <span className={`${FONT.sm} text-muted-foreground`}>{row.runId ? t('View run') : ''}</span>
    </>
  );
  const className = 'grid w-full grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-2 text-left';
  return row.runId
    ? <button type="button" onClick={() => onOpenRun(row.runId!)} className={`${className} hover:bg-muted/40`}>{body}</button>
    : <div className={className}>{body}</div>;
}

export function AuditCredentials({ spaceId, onOpenRun }: {
  spaceId: string | null;
  onOpenRun: (runId: string) => void;
}) {
  const { t } = useI18n();
  const history = useCredentialHistory(spaceId);
  const [filter, setFilter] = useState<CredentialHistoryFilter>('all');
  const shown = filterCredentialHistory(history.rows, filter);
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const views = VIEWS.map((view) => ({ ...view, label: t(view.label), description: view.description && t(view.description) }));
  return (
    <ToolPage crumbs={[{ id: 'tool', label: t('Audit') }, { id: 'page', label: t('Credential history') }]} storageKey="audit-credentials" home="all"
      views={views} activeView="all" onSelectView={() => {}}
      actions={<Button size="icon-sm" variant="ghost" onClick={() => history.refetch()} aria-label={t('Refresh')} title={t('Refresh')}><RefreshCw size={14} /></Button>}>
      <div className="space-y-4">
        {history.error
          ? <p role="alert" className={`${FONT.base} rounded-md bg-[var(--status-danger-subtle)] p-3 text-foreground`}>{t('Could not read the credential history.')}</p>
          : history.loading
            ? <p className={`${FONT.base} text-muted-foreground`}>{t('Loading the credential history…')}</p>
            : (
              <>
                <div className="flex flex-wrap gap-1">
                  {FILTERS.map((f) => (
                    <Button key={f.id} shape="tab" size="xs" variant={filter === f.id ? 'secondary' : 'ghost'} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                      {t(f.label)}
                    </Button>
                  ))}
                </div>
                {history.truncated && (
                  <p className={`${FONT.sm} text-muted-foreground`}>{t('Showing the latest {n} touches.', { n: CREDENTIAL_HISTORY_LIMIT.toLocaleString() })}</p>
                )}
                {shown.length
                  ? <div className="space-y-0.5">{shown.map((row) => <CredentialRow key={row.id} row={row} onOpenRun={onOpenRun} />)}</div>
                  : <Empty>{t(active.empty)}</Empty>}
              </>
            )}
      </div>
    </ToolPage>
  );
}

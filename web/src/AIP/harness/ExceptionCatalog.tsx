'use client';

import { useState } from 'react';
import { Button } from '@/ui/button';
import { CARD_FLAT, FONT } from '@/shared/designTokens';
import { formatError } from '@/Function/shared/formatError';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useCatalog } from '@/hooks/customizeData';
import {
  installCatalogException, setCatalogExceptionEnabled, uninstallCatalogException, useExceptionInstalls,
} from '@/hooks/exceptionData';
import { exceptionInstallState, parseExceptionPayload, type ExceptionRowSummary } from './exceptionCatalogModel';
import type { EscalateTarget } from './harnessDefinition';

// Settings › AI › Harnesses, below the harness catalog: the
// exception catalog (B13). An installed entry speaks for the whole
// Space's failures — retries, rollbacks, who is told — wherever a
// definition's own failure section is silent, so installing one is
// the owner's act (the RPCs re-check it), and the panel only offers
// the buttons to owners. Nothing here edits an entry: the catalog is
// Clayware's, a Space chooses which entries govern it.

const ESCALATE_LABEL: Record<EscalateTarget, string> = {
  owner: 'Space owners',
  strategy: 'the Strategy’s owner',
  inbox: 'the Inbox',
};

function RowSummary({ row }: { row: ExceptionRowSummary }) {
  const { t } = useI18n();
  const parts: string[] = [];
  if (row.retry != null) parts.push(row.retry > 0 ? t('Retry up to {n} times', { n: row.retry }) : t('No retry'));
  if (row.compensate === 'auto') parts.push(t('Roll back automatically'));
  else if (row.compensate === 'ask') parts.push(t('Ask before rolling back'));
  else if (row.compensate === 'never') parts.push(t('Never roll back'));
  parts.push(t('Escalate to {target}', { target: t(ESCALATE_LABEL[row.escalate]) }));
  if (row.giveUpAfter != null) parts.push(t('Give up after {n} failures', { n: row.giveUpAfter }));
  return (
    <p className="text-[12px] text-muted-foreground">
      <span className="text-foreground">{t('When {class} fails', { class: row.failureClass })}</span>
      {' — '}{parts.join(' · ')}
    </p>
  );
}

export function ExceptionCatalogSection({ spaceId, isOwner }: { spaceId: string | null; isOwner: boolean }) {
  const { t } = useI18n();
  const catalog = useCatalog();
  const installs = useExceptionInstalls(spaceId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!catalog.exceptions.length) return null;
  const installOf = new Map(installs.data.map((i) => [i.catalogItemId, i]));

  const act = async (itemId: string, f: () => Promise<void>) => {
    setBusy(itemId); setError(null);
    try { await f(); await installs.refetch(); } catch (e) { setError(formatError(e)); } finally { setBusy(null); }
  };

  return (
    <div>
      <h2 className={`${FONT.lg} text-foreground`}>{t('Exception catalog')}</h2>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        {t('Shared rules for what happens when work fails — retries, rollbacks, and who is told — where a definition’s own failure section is silent.')}
      </p>
      {error && <p className="mt-2 text-[12px] text-[var(--status-danger)]">{error}</p>}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {catalog.exceptions.map((item) => {
          const install = installOf.get(item.id) ?? null;
          const state = exceptionInstallState(item, install);
          const summary = parseExceptionPayload(item.payload);
          return (
            <div key={item.id} className={`${CARD_FLAT} flex flex-col gap-2 p-4`}>
              <div className="text-[13px] font-semibold text-foreground">{item.name}</div>
              <p className="line-clamp-2 text-[12px] text-muted-foreground">{item.description}</p>
              {summary ? (
                <div className="space-y-0.5">
                  {summary.match.destinationPattern && (
                    <p className="text-[12px] text-muted-foreground">{t('Only for destinations matching {pattern}', { pattern: summary.match.destinationPattern })}</p>
                  )}
                  {summary.match.tool && (
                    <p className="text-[12px] text-muted-foreground">{t('Only for the {tool} action', { tool: summary.match.tool })}</p>
                  )}
                  {summary.rows.map((row) => <RowSummary key={row.failureClass} row={row} />)}
                </div>
              ) : (
                <p className="text-[12px] text-[var(--status-warning)]">{t('This entry’s settings could not be read, so it has no effect.')}</p>
              )}
              <div className="mt-auto flex items-center gap-2 pt-1">
                {state.kind === 'current' && <span className="text-[11px] text-[var(--status-success)]">{t('Installed')}</span>}
                {state.kind === 'update-available' && <span className="text-[11px] text-[var(--status-warning)]">{t('Update available')}</span>}
                {state.kind === 'disabled' && <span className="text-[11px] text-muted-foreground">{t('Off')}</span>}
                {isOwner && spaceId && (
                  <span className="ml-auto flex items-center gap-1">
                    {state.kind === 'not-installed' && (
                      <Button size="xs" variant="secondary" disabled={busy !== null}
                        onClick={() => void act(item.id, () => installCatalogException(spaceId, item.id))}>
                        {busy === item.id ? t('Adding…') : t('Install')}
                      </Button>
                    )}
                    {state.kind === 'update-available' && (
                      <Button size="xs" variant="ghost" disabled={busy !== null}
                        onClick={() => void act(item.id, () => installCatalogException(spaceId, item.id))}>
                        {t('Update v{from} → v{to}', { from: state.installedVersion, to: state.catalogVersion })}
                      </Button>
                    )}
                    {state.kind === 'disabled' && (
                      <Button size="xs" variant="ghost" disabled={busy !== null}
                        onClick={() => void act(item.id, () => setCatalogExceptionEnabled(spaceId, item.id, true))}>
                        {t('Turn on')}
                      </Button>
                    )}
                    {(state.kind === 'current' || state.kind === 'update-available') && (
                      <Button size="xs" variant="ghost" disabled={busy !== null}
                        onClick={() => void act(item.id, () => setCatalogExceptionEnabled(spaceId, item.id, false))}>
                        {t('Turn off')}
                      </Button>
                    )}
                    {state.kind !== 'not-installed' && (
                      <Button size="xs" variant="ghost" disabled={busy !== null}
                        onClick={() => void act(item.id, () => uninstallCatalogException(spaceId, item.id))}>
                        {t('Uninstall')}
                      </Button>
                    )}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

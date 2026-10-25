'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { useCurrentUserId } from '@/providers/authContext';
import { ElementIntake } from '@/ActivitySpace/execution/element/intake/ElementIntake';
import { ElementImportRejectedError, intakeTextFromRows, type ElementImportRow } from '@/Function/shared/element/intakeModel';
import { clearPendingWorkImport, importExistingWork, readPendingWorkImport, rememberPendingWorkImport, resolveExistingWork, type PendingWorkImport } from '@/hooks/importExistingWork';
import type { NowWorkData } from '@/hooks/coordinationData';
import type { Domain } from '@/types/database';
import { useI18n } from '@/Function/i18n/I18nProvider';

export function WorkImportFlow({ spaceId, data, domains, onDone, onCancel }: {
  spaceId: string;
  data: NowWorkData;
  domains: Domain[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const userId = useCurrentUserId();
  const [objectId, setObjectId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [domainId, setDomainId] = useState(domains[0]?.id ?? '');
  const [locked, setLocked] = useState(false);
  const request = useRef<PendingWorkImport | null>(null);
  const batchId = useRef(crypto.randomUUID());
  const [checking, setChecking] = useState(true);
  const [restored, setRestored] = useState<PendingWorkImport | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [recoveredText, setRecoveredText] = useState('');
  const resumingRef = useRef(false);
  const uncertain = useRef(false);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        if (!userId) throw new Error(t('Sign in before importing work.'));
        const pending = readPendingWorkImport(window.sessionStorage, userId, spaceId);
        request.current = pending;
        uncertain.current = !!pending;
        setRestored(pending);
        setRestoreError(null);
      } catch (error) {
        setRestoreError(error instanceof Error ? error.message : t('The previous import could not be restored.'));
      } finally { setChecking(false); }
    });
    return () => { active = false; };
  }, [userId, spaceId, t]);

  const save = async (rows: ElementImportRow[]) => {
    if (!userId) throw new Error(t('Sign in before importing work.'));
    if (!request.current) {
      if (!objectId && !projectName.trim()) throw new Error(t('Name this project before importing.'));
      const pending: PendingWorkImport = { version: 1, target: {
        userId, spaceId, batchId: batchId.current, objectId: objectId || null,
        domainId: objectId ? null : domainId || null, projectName: objectId ? '' : projectName.trim(),
      }, rows: structuredClone(rows) };
      // Persist before sending. Cancel, remount, or reload must reuse this batch.
      rememberPendingWorkImport(window.sessionStorage, pending);
      request.current = pending;
      setLocked(true);
    }
    const pending = request.current;
    if (JSON.stringify(rows) !== JSON.stringify(pending.rows)) throw new Error(t('The reviewed import changed. Retry the original request.'));
    try {
      const result = await importExistingWork(pending.target, pending.rows);
      clearPendingWorkImport(window.sessionStorage, pending.target);
      return result;
    } catch (error) {
      if (error instanceof ElementImportRejectedError && !uncertain.current) {
        clearPendingWorkImport(window.sessionStorage, pending.target);
        request.current = null;
        batchId.current = crypto.randomUUID();
        setLocked(false);
        throw error;
      }
      uncertain.current = true;
      setRestored(pending);
      setRestoreError(error instanceof Error ? error.message : t('Could not confirm this import.'));
      // A rejection after an uncertain attempt cannot prove that earlier work
      // was not committed. Keep the request until explicit atomic resolution.
      throw new Error(error instanceof Error ? error.message : t('Could not confirm this import.'));
    }
  };

  const resume = async () => {
    if (!restored || resumingRef.current) return;
    resumingRef.current = true;
    setResuming(true);
    setRestoreError(null);
    try {
      await importExistingWork(restored.target, restored.rows);
      clearPendingWorkImport(window.sessionStorage, restored.target);
      setConfirmed(true);
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : t('Could not confirm this import. Retry the same request.'));
    } finally { resumingRef.current = false; setResuming(false); }
  };

  const resolve = async () => {
    if (!restored || resumingRef.current) return;
    resumingRef.current = true; setResuming(true); setRestoreError(null);
    try {
      const outcome = await resolveExistingWork(restored.target);
      clearPendingWorkImport(window.sessionStorage, restored.target);
      if (outcome.committed) { setConfirmed(true); setUnavailable(!outcome.available); }
      else {
        setRecoveredText(intakeTextFromRows(restored.rows));
        setObjectId(data.objects.some((object) => object.id === restored.target.objectId) ? restored.target.objectId! : '');
        setProjectName(restored.target.projectName);
        setDomainId(domains.some((domain) => domain.id === restored.target.domainId) ? restored.target.domainId! : domains[0]?.id ?? '');
        request.current = null; uncertain.current = false; batchId.current = crypto.randomUUID();
        setLocked(false); setRestored(null);
      }
    } catch (error) { setRestoreError(error instanceof Error ? error.message : t('The previous import outcome is still unknown.')); }
    finally { resumingRef.current = false; setResuming(false); }
  };

  if (checking) return <p className="text-sm text-muted-foreground" role="status">{t('Checking for an unfinished import…')}</p>;
  if (restored || restoreError) return <div className="space-y-4" aria-busy={resuming}>
    <div className="space-y-1" aria-live="polite">
      <h2 className="text-base font-semibold">{t(confirmed ? 'Import confirmed' : 'Continue your previous import')}</h2>
      {restored && <p className="text-sm text-muted-foreground">{confirmed
        ? unavailable ? t('The previous import was saved, but some work has since been removed or is no longer visible. It has not been imported again.') : t('{n} Elements are saved.', { n: restored.rows.length })
        : restored.target.projectName
          ? t('Confirm the same {n} Elements for {project}. If the previous request reached the server, it will return the existing work.', { n: restored.rows.length, project: restored.target.projectName })
          : t('Confirm the same {n} Elements. If the previous request reached the server, it will return the existing work.', { n: restored.rows.length })}</p>}
      {!confirmed && <p className="text-xs text-muted-foreground">{t('This browser tab retains the request until it is confirmed. Closing this screen keeps it available here.')}</p>}
    </div>
    {restoreError && <p role="alert" className="break-words text-sm text-destructive">{restoreError}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <Button disabled={resuming} onClick={confirmed ? onDone : onCancel}>{t(confirmed ? 'Done' : 'Close')}</Button>
      {restored && !confirmed && <Button disabled={resuming} onClick={resolve}>{t('Check outcome and edit')}</Button>}
      {restored && !confirmed && <Button variant="primary" disabled={resuming} onClick={resume}>{t(resuming ? 'Confirming…' : 'Confirm same import')}</Button>}
    </div>
  </div>;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-[12px] text-muted-foreground">
          <span>{t('Put this work in')}</span>
          <select aria-label={t('Import destination')} value={objectId} onChange={e => setObjectId(e.target.value)} disabled={locked}
            className="h-8 w-full rounded-md border-0 bg-muted px-2 text-[13px] text-foreground">
            <option value="">{t('New project')}</option>
            {data.objects.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        {!objectId && <label className="space-y-1 text-[12px] text-muted-foreground">
          <span>{t('Project name')}</span>
          <input value={projectName} onChange={e => setProjectName(e.target.value)} maxLength={160} disabled={locked}
            placeholder={t('The work your team is already doing')}
            className="h-8 w-full rounded-md border-0 bg-muted px-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:bg-accent" />
        </label>}
        {!objectId && domains.length > 1 && <label className="space-y-1 text-[12px] text-muted-foreground">
          <span>{t('Domain')}</span>
          <select aria-label={t('Project Domain')} value={domainId} onChange={e => setDomainId(e.target.value)} disabled={locked}
            className="h-8 w-full rounded-md border-0 bg-muted px-2 text-[13px] text-foreground">
            {domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>}
      </div>
      <p className="text-[12px] text-muted-foreground">{t('Start with one real project. Review the rows before saving. This is a copy; changes do not sync back to your previous tool.')}</p>
      <ElementIntake workers={data.workers} initialText={recoveredText} onImport={save} onDone={onDone} onCancel={onCancel}
        objectName={objectId ? data.objects.find(o => o.id === objectId)?.name : projectName.trim() || t('New project')} />
    </div>
  );
}

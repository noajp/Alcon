'use client';

import { formatError } from '@/Function/shared/formatError';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { CARD_FLAT, FONT } from '@/shared/designTokens';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import { useIntegrations, useIsSpaceOwner } from '@/AIP/connectors/data';
import { signsInWithOAuth } from '@/AIP/connectors/catalog';
import { ConnectDialogHost, openedForPreset, openedForRegistryEntry, type OpenedConnection } from '@/AIP/connectors/ConnectDialogHost';
import { saveOAuthReturnSettingsTab, useOAuthOutcome } from '@/AIP/connectors/oauthReturn';
import { applyDefinitionCatalogUpdate, createDefinition, deleteDefinition, markDefinitionCatalogVersion, setDefinitionEnabled, updateDefinition, useDefinitions, useSpaceDefaultHarness, type Definition } from '@/hooks/definitionData';
import { resolveRevisionCandidate, useDefinitionCalibration } from '@/hooks/calibrationData';
import { calibrationSummaryOf, candidateErrorCount, ratePercent } from './calibrationModel';
import { activateConstraintDraft, deactivatePlanningConstraint, rejectConstraintDraft, useDefinitionConstraints, useSpaceConstraintQueue } from '@/hooks/constraintData';
import { constraintEffectOf, constraintKpiOf, draftBaselineOf } from './constraintModel';
import { useCatalog, useConnectorDirectory, type CatalogDefinition } from '@/hooks/customizeData';
import { useExceptionInstalls } from '@/hooks/exceptionData';
import { ExceptionCatalogSection } from './ExceptionCatalog';
import { checkHarness, parseDefinition, type Diagnostic } from './harnessDefinition';
import { catalogRelation, lineDiffCounts } from './installState';
import { enabledConnectedNames, installReadiness, missingConnectors } from './installFlow';
import { clearInstallSession, saveInstallSession, takeInstallSession } from './installReturn';
import { RegistrySection } from './RegistrySection';
import { PromotionsSection } from './PromotionDrafts';
import { YoursDiscover, type CustomizeMode } from './YoursDiscover';
import { TryDefinition } from './TryDefinition';

// Settings › AI › Harnesses: how a kind of work is carried out by AI — the
// goal, the steps or loop, where it stops, the result's shape, the
// connectors it uses and, for a Strategy, how it is broken down. Yours is the
// Space's library, shared by its members; one of them may be the Space's
// default, which Strategies are worked by when they name none (otherwise
// Alcon's built-in way). Discover is the catalog Alcon offers to start from,
// added by copying into the library. Adding one starts an install walk: the
// connectors it still needs are connected one at a time through the usual
// connection dialog, then the harness is checked again. A walk left
// unfinished is not a failure — the definition stays installed and its row
// shows what it still needs. Every harness is checked as it is written
// (checkHarness), against the Space's enabled connections.

/** The fold connector names are matched by (the same fold as checkHarness and the runtime). */
const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');

/** One install walk, in progress or settled. Missing connectors are
 *  derivable at any time, so this is only the walk's own bookkeeping. */
interface InstallSession {
  definitionId: string;
  catalogId: string;
  phase: 'connecting' | 'needs-choice' | 'checking' | 'complete' | 'incomplete';
  /** Missing count when the walk started (the progress denominator). */
  totalMissing: number;
  /** Folded names already opened once this session (the loop guard). */
  attempted: string[];
  /** Why the walk stopped, when it ended incomplete. */
  note: string | null;
}

export function HarnessesPanel() {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const library = useDefinitions(spaceId);
  const catalog = useCatalog();
  const exceptionInstalls = useExceptionInstalls(spaceId);
  // The checker's exception knowledge (B13): what the catalog offers
  // and what this Space has installed, so a definition's exceptions
  // section is judged against both (F005 / F006).
  const exceptionsCtx = useMemo(() => ({
    catalog: catalog.exceptions.map((e) => e.id),
    installed: exceptionInstalls.data.map((i) => i.catalogItemId),
  }), [catalog.exceptions, exceptionInstalls.data]);
  const fallback = useSpaceDefaultHarness(spaceId);
  const isOwner = useIsSpaceOwner(spaceId) === true;
  const integrations = useIntegrations(spaceId);
  // "Connected" is the runtime's test: enabled connections only.
  const connected = useMemo(() => enabledConnectedNames(integrations.data), [integrations.data]);
  const connectedEndpoints = useMemo(() => new Set(integrations.data.map((i) => i.endpoint)), [integrations.data]);
  const [mode, setMode] = useState<CustomizeMode>('yours');
  const [editing, setEditing] = useState<Definition | 'new' | null>(null);
  const [preview, setPreview] = useState<CatalogDefinition | null>(null);
  const [trying, setTrying] = useState<Definition | null>(null);
  const [reviewing, setReviewing] = useState<{ definition: Definition; item: CatalogDefinition } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const added = new Set(library.data.map((d) => d.source_id).filter(Boolean));
  const defaultHarness = library.data.find((d) => d.id === fallback.data) ?? null;
  const catalogById = useMemo(() => new Map(catalog.definitions.map((i) => [i.id, i])), [catalog.definitions]);

  // ── The install walk ────────────────────────────────────────────────────
  const [session, setSession] = useState<InstallSession | null>(null);
  const [opened, setOpened] = useState<OpenedConnection | null>(null);
  const [activeNeed, setActiveNeed] = useState<string | null>(null);
  const [choiceFor, setChoiceFor] = useState<string | null>(null);
  const directory = useConnectorDirectory(choiceFor ?? '', !!choiceFor);
  const oauthOutcome = useOAuthOutcome();
  const sessionDef = session ? library.data.find((d) => d.id === session.definitionId) ?? null : null;
  const sessionName = sessionDef?.name ?? (session ? catalog.definitions.find((i) => i.id === session.catalogId)?.name ?? '' : '');

  const startWalk = (definition: Definition, catalogId: string) => {
    const missing = missingConnectors(parseDefinition(definition.body).connectors, integrations.data);
    if (!isOwner && missing.length) {
      setSession({
        definitionId: definition.id, catalogId, phase: 'incomplete', totalMissing: missing.length, attempted: [],
        note: t('Only a Space owner can connect these: {names}.', { names: missing.map((m) => m.name).join(', ') }),
      });
      return;
    }
    setSession({ definitionId: definition.id, catalogId, phase: 'connecting', totalMissing: missing.length, attempted: [], note: null });
  };

  // Drive the walk: open the dialog for the first missing connector not yet
  // attempted this session; a name with no preset goes to the registry step.
  /* eslint-disable react-hooks/set-state-in-effect -- the walk is a state machine over the Space's connections, an outside store; their changes advance it */
  useEffect(() => {
    if (!session || session.phase !== 'connecting' || opened || !sessionDef || !spaceId) return;
    const missing = installReadiness(sessionDef, integrations.data).missing;
    if (!missing.length) { setSession((s) => (s ? { ...s, phase: 'checking' } : s)); return; }
    if (!isOwner) {
      setSession((s) => (s ? {
        ...s, phase: 'incomplete',
        note: t('Only a Space owner can connect these: {names}.', { names: missing.map((m) => m.name).join(', ') }),
      } : s));
      return;
    }
    const next = missing.find((n) => !session.attempted.includes(fold(n.name)));
    if (!next) {
      setSession((s) => (s ? { ...s, phase: 'incomplete', note: t('{name} is not connected yet', { name: missing[0].name }) } : s));
      return;
    }
    if (next.preset) {
      // A sign-in with OAuth leaves the app: keep the walk's place for the return.
      if (signsInWithOAuth(next.preset)) {
        saveInstallSession({ spaceId, definitionId: session.definitionId, catalogId: session.catalogId });
        saveOAuthReturnSettingsTab('definitions');
      }
      setActiveNeed(next.name);
      setOpened(openedForPreset(next.preset, integrations.data));
    } else {
      setChoiceFor(next.name);
      setSession((s) => (s ? { ...s, phase: 'needs-choice' } : s));
    }
  }, [session, opened, sessionDef, spaceId, integrations.data, isOwner, t]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // The registry step: an exact title match opens at once; anything else is
  // the person's pick in the step's own dialog.
  /* eslint-disable react-hooks/set-state-in-effect -- the registry's answer arrives from outside the component; an exact match opens its dialog */
  useEffect(() => {
    if (!session || session.phase !== 'needs-choice' || !choiceFor || opened || directory.loading) return;
    const exact = directory.data.find((e) => fold(e.title) === fold(choiceFor));
    if (!exact) return;
    setActiveNeed(choiceFor);
    setOpened(openedForRegistryEntry(exact));
    setSession((s) => (s ? { ...s, phase: 'connecting' } : s));
  }, [session, choiceFor, opened, directory.loading, directory.data]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // The walk's last step is the check itself: passing means no connector is
  // missing and no error-severity diagnostic remains.
  /* eslint-disable react-hooks/set-state-in-effect -- the check's verdict over the outside connections is what settles the walk */
  useEffect(() => {
    if (!session || session.phase !== 'checking' || !sessionDef) return;
    const r = installReadiness(sessionDef, integrations.data);
    if (r.passing) {
      clearInstallSession();
      setSession((s) => (s ? { ...s, phase: 'complete' } : s));
    } else if (r.missing.length) {
      setSession((s) => (s ? { ...s, phase: 'connecting', attempted: [] } : s));
    } else {
      const firstError = r.diagnostics.find((d) => d.severity === 'error');
      setSession((s) => (s ? { ...s, phase: 'incomplete', note: firstError ? firstError.message : null } : s));
    }
  }, [session, sessionDef, integrations.data]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // A walk kept across an OAuth sign-in resumes at the recompute step, once
  // the sign-in's outcome is known.
  const restoreTried = useRef(false);
  /* eslint-disable react-hooks/set-state-in-effect -- the stored session and the sign-in's outcome are outside stores; their arrival resumes the walk */
  useEffect(() => {
    if (restoreTried.current || !spaceId || library.loading || !oauthOutcome || oauthOutcome.status === 'pending') return;
    restoreTried.current = true;
    const stored = takeInstallSession();
    if (!stored || stored.spaceId !== spaceId) return;
    const def = library.data.find((d) => d.id === stored.definitionId);
    if (!def) return;
    if (oauthOutcome.status === 'error') {
      setSession({
        definitionId: def.id, catalogId: stored.catalogId, phase: 'incomplete', totalMissing: 1, attempted: [],
        note: t('Sign-in did not finish, so nothing was connected. Try again.'),
      });
      return;
    }
    void integrations.refetch();
    const missing = missingConnectors(parseDefinition(def.body).connectors, integrations.data);
    setSession({ definitionId: def.id, catalogId: stored.catalogId, phase: 'connecting', totalMissing: Math.max(missing.length, 1), attempted: [], note: null });
  }, [oauthOutcome, spaceId, library, integrations, t]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const closeDialog = async () => {
    setOpened(null);
    const need = activeNeed;
    setActiveNeed(null);
    setChoiceFor(null);
    if (need) setSession((s) => (s ? { ...s, attempted: [...s.attempted, fold(need)] } : s));
    await integrations.refetch();
  };
  const skipNeed = () => {
    if (choiceFor) setSession((s) => (s ? { ...s, attempted: [...s.attempted, fold(choiceFor)], phase: 'connecting' } : s));
    setChoiceFor(null);
  };
  const cancelWalk = () => {
    setSession(null); setOpened(null); setActiveNeed(null); setChoiceFor(null);
    clearInstallSession();
  };
  const endWalkIncomplete = () => {
    setOpened(null); setActiveNeed(null); setChoiceFor(null);
    setSession((s) => (s ? { ...s, phase: 'incomplete', note: t('Connect the rest later, from the harness’s row in the library.') } : s));
  };
  const retryWalk = () => setSession((s) => (s ? { ...s, phase: 'connecting', attempted: [], note: null } : s));
  const dismissWalk = () => { setSession(null); clearInstallSession(); };

  const act = async (id: string, f: () => Promise<unknown>) => {
    setBusy(id); setError(null);
    try { await f(); } catch (e) { setError(formatError(e)); }
    setBusy(null);
  };
  const add = (item: CatalogDefinition) => act(item.id, async () => {
    if (!spaceId) return;
    const created = await createDefinition({ spaceId, name: item.name, body: item.body, sourceId: item.id, sourceVersion: item.version });
    await library.refetch();
    startWalk(created, item.id);
  });

  const sessionReadiness = sessionDef ? installReadiness(sessionDef, integrations.data) : null;
  const sessionDone = session ? session.totalMissing - (sessionReadiness ? sessionReadiness.missing.length : session.totalMissing) : 0;
  const sessionWarnings = sessionReadiness?.diagnostics.some((d) => d.severity === 'warning') ?? false;
  const canRetry = isOwner && !!sessionReadiness && sessionReadiness.missing.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`${FONT.lg} text-foreground`}>{t('Harnesses')}</h2>
        </div>
        <div className="flex items-center gap-2">
          <YoursDiscover mode={mode} onChange={setMode} />
          {mode === 'yours' && <Button size="sm" variant="secondary" onClick={() => setEditing('new')} disabled={!spaceId}>{t('New harness')}</Button>}
        </div>
      </div>

      <div className="rounded-md bg-[var(--surface-strong)] px-3 py-2 text-[12px] text-foreground">
        {defaultHarness
          ? defaultHarness.enabled
            ? t('Default harness: {name}', { name: defaultHarness.name })
            : t('Default harness: {name} · Off — Strategies use Alcon’s built-in way', { name: defaultHarness.name })
          : t('No default harness — Strategies use Alcon’s built-in way')}
      </div>
      {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}

      {session && (
        <div className="rounded-md bg-[var(--surface-strong)] px-3 py-2 text-[12px] text-foreground" role="status">
          {session.phase === 'complete' ? (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                {sessionWarnings
                  ? t('{name} is installed — with check warnings', { name: sessionName })
                  : t('{name} is installed and passing', { name: sessionName })}
              </span>
              <Button size="xs" variant="ghost" onClick={dismissWalk}>{t('Dismiss')}</Button>
            </div>
          ) : session.phase === 'incomplete' ? (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">{session.note ?? t('{name} is not fully set up yet', { name: sessionName })}</span>
              {canRetry && <Button size="xs" variant="secondary" onClick={retryWalk}>{t('Retry')}</Button>}
              <Button size="xs" variant="ghost" onClick={dismissWalk}>{t('Dismiss')}</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">{t('Connectors for {harness} — {done} of {total} connected', { harness: sessionName, done: sessionDone, total: session.totalMissing })}</span>
              <Button size="xs" variant="ghost" onClick={endWalkIncomplete}>{t('Skip')}</Button>
              <Button size="xs" variant="ghost" onClick={cancelWalk}>{t('Cancel')}</Button>
            </div>
          )}
        </div>
      )}

      {mode === 'yours' && (
        <PromotionsSection spaceId={spaceId} isOwner={isOwner} definitions={library.data}
          onChanged={() => { void library.refetch(); }} />
      )}

      {mode === 'yours' && (
        <ConstraintsSection spaceId={spaceId} isOwner={isOwner} />
      )}

      {mode === 'yours' ? (
        library.loading ? <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>
          : library.data.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">{t('This Space has no harnesses yet. Add one from Discover or write a new one.')}</p>
          ) : (
            <div>
              {library.data.map((d) => {
                const isDefault = d.id === fallback.data;
                const item = d.source_id ? catalogById.get(d.source_id) ?? null : null;
                const relation = catalogRelation(d, item);
                const needs = installReadiness(d, integrations.data).missing;
                return (
                  <div key={d.id} className="-mx-2 flex w-[calc(100%+16px)] items-center gap-2 rounded-md px-2 transition-colors hover:bg-[var(--surface-strong)]">
                    <button type="button" onClick={() => setEditing(d)}
                      className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left outline-none focus-visible:underline">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-foreground">{d.name}</span>
                          {isDefault && <span className="shrink-0 rounded-full border border-[var(--border-default)] px-1.5 text-[11px] text-[var(--text-secondary)]">{t('Default')}</span>}
                          {d.promoted_from_draft_id && <span className="shrink-0 rounded-full border border-[var(--border-default)] px-1.5 text-[11px] text-[var(--text-secondary)]">{t('Promoted')}</span>}
                          {!d.enabled && <span className="shrink-0 rounded-full border border-[var(--border-default)] px-1.5 text-[11px] text-muted-foreground">{t('Off')}</span>}
                          {(relation.kind === 'current' || relation.kind === 'legacy-unknown') && relation.differs && (
                            <span className="shrink-0 rounded-full border border-[var(--border-default)] px-1.5 text-[11px] text-muted-foreground">{t('Edited locally')}</span>
                          )}
                          {needs.length > 0 && (
                            <span className="shrink-0 rounded-full border border-[var(--border-default)] px-1.5 text-[11px] text-[var(--status-warning)]">
                              {t('Needs: {names}', { names: needs.map((n) => n.name).join(', ') })}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[12px] text-muted-foreground">{firstLine(d.body)}</div>
                      </div>
                      <CheckSummary diagnostics={checkHarness(parseDefinition(d.body), { connected, exceptions: exceptionsCtx })} />
                    </button>
                    {needs.length > 0 && (
                      <Button size="xs" variant="ghost" disabled={busy !== null}
                        onClick={() => startWalk(d, d.source_id ?? '')}>
                        {t('Set up connectors')}
                      </Button>
                    )}
                    {relation.kind === 'update-available' && item && (
                      <Button size="xs" variant="ghost" disabled={busy !== null}
                        onClick={() => setReviewing({ definition: d, item })}>
                        {t('Update v{from} → v{to}', { from: relation.installedVersion, to: relation.catalogVersion })}
                      </Button>
                    )}
                    {relation.kind === 'legacy-unknown' && item && (
                      <Button size="xs" variant="ghost" disabled={busy !== null}
                        onClick={() => setReviewing({ definition: d, item })}>
                        {t('Review catalog version')}
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" disabled={busy !== null}
                      onClick={() => void act(d.id, async () => { await setDefinitionEnabled(d.id, !d.enabled); await library.refetch(); })}>
                      {d.enabled ? t('Turn off') : t('Turn on')}
                    </Button>
                    {isOwner && (
                      <Button size="xs" variant="ghost" disabled={busy !== null || !d.enabled}
                        onClick={() => void act(d.id, () => fallback.set(isDefault ? null : d.id))}>
                        {isDefault ? t('Stop using as default') : t('Make default')}
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" disabled={!d.enabled} onClick={() => setTrying(d)}>{t('Try')}</Button>
                  </div>
                );
              })}
            </div>
          )
      ) : catalog.loading ? <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p> : (
        <div className="space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {catalog.definitions.map((item) => (
            <div key={item.id} className={`${CARD_FLAT} flex flex-col gap-2 p-4`}>
              <div className="text-[13px] font-semibold text-foreground">{item.name}</div>
              <p className="line-clamp-2 text-[12px] text-muted-foreground">{item.description}</p>
              <ConnectorChips names={parseDefinition(item.body).connectors} connected={connected} />
              <div className="mt-auto flex items-center gap-2 pt-1">
                <Button size="xs" variant="ghost" onClick={() => setPreview(item)}>{t('Preview')}</Button>
                {added.has(item.id)
                  ? <span className="ml-auto text-[11px] text-[var(--status-success)]">{t('Installed')}</span>
                  : <Button size="xs" variant="secondary" className="ml-auto" onClick={() => void add(item)} disabled={busy !== null || !spaceId}>{busy === item.id ? t('Adding…') : t('Add')}</Button>}
              </div>
            </div>
          ))}
        </div>
        <ExceptionCatalogSection spaceId={spaceId} isOwner={isOwner} />
        </div>
      )}

      {preview && (
        <Dialog open onOpenChange={(o) => { if (!o) setPreview(null); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{preview.name}</DialogTitle></DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto text-[13px]"><MarkdownLite text={preview.body} /></div>
            <DialogFooter>
              {added.has(preview.id)
                ? <span className="text-[12px] text-[var(--status-success)]">{t('Installed')}</span>
                : <Button size="sm" onClick={() => void add(preview).then(() => setPreview(null))} disabled={busy !== null}>{t('Add')}</Button>}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {reviewing && (
        <CatalogReviewDialog definition={reviewing.definition} item={reviewing.item}
          onClose={() => setReviewing(null)}
          onDone={() => { void library.refetch(); setReviewing(null); }} />
      )}

      {opened && spaceId && (
        <ConnectDialogHost spaceId={spaceId} opened={opened} integrations={integrations.data} canEdit={isOwner}
          onClose={() => void closeDialog()}
          onCreated={(created) => setOpened((o) => (o ? { preset: o.preset, integration: created } : o))} />
      )}

      {session?.phase === 'needs-choice' && choiceFor && (
        <Dialog open onOpenChange={(o) => { if (!o) skipNeed(); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{t('Connect {name}', { name: choiceFor })}</DialogTitle></DialogHeader>
            <RegistrySection connectedEndpoints={connectedEndpoints} canAdd={isOwner} initialQuery={choiceFor}
              onAdd={(e) => {
                setActiveNeed(choiceFor);
                setOpened(openedForRegistryEntry(e));
                setSession((s) => (s ? { ...s, phase: 'connecting' } : s));
              }} />
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={skipNeed}>{t('Skip')}</Button>
              <Button variant="ghost" size="sm" onClick={cancelWalk}>{t('Cancel')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {trying && <TryDefinition definition={trying} onClose={() => setTrying(null)} />}

      {editing && spaceId && (
        <HarnessEditor spaceId={spaceId} definition={editing === 'new' ? null : editing} connected={connected} isOwner={isOwner}
          exceptions={exceptionsCtx}
          onClose={() => setEditing(null)} onSaved={() => { void library.refetch(); setEditing(null); }} />
      )}
    </div>
  );
}

/** An installed copy held against the catalog version it came from: how far
 *  the texts have drifted, and the choice to take the catalog version —
 *  or, for an untouched copy from before versioning, to record which
 *  catalog version it already is. Updating replaces; nothing is merged. */
function CatalogReviewDialog({ definition, item, onClose, onDone }: {
  definition: Definition; item: CatalogDefinition; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const relation = catalogRelation(definition, item);
  const differs = 'differs' in relation ? relation.differs : false;
  const counts = lineDiffCounts(definition.body, item.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await f(); onDone(); } catch (e) { setError(formatError(e)); setBusy(false); }
  };
  const canUpdate = relation.kind === 'update-available' || (relation.kind === 'legacy-unknown' && differs);
  const canRecord = relation.kind === 'legacy-unknown' && !differs;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{definition.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-[12px] tabular-nums text-muted-foreground">{t('−{removed} / +{added} lines', { removed: counts.removed, added: counts.added })}</p>
          {differs && (
            <p className="text-[12px] text-foreground">{t('This copy differs from the catalog version. Updating replaces its name and text; local edits are not merged.')}</p>
          )}
          <div>
            <div className="mb-1 text-[11px] text-muted-foreground">{t('Installed copy')}</div>
            <div className="max-h-[24vh] overflow-y-auto rounded-md border border-[var(--border-default)] p-3 text-[13px]"><MarkdownLite text={definition.body} /></div>
          </div>
          <div>
            <div className="mb-1 text-[11px] text-muted-foreground">{t('Catalog version')}</div>
            <div className="max-h-[24vh] overflow-y-auto rounded-md border border-[var(--border-default)] p-3 text-[13px]"><MarkdownLite text={item.body} /></div>
          </div>
          {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>{t('Close')}</Button>
          {canRecord && (
            <Button size="sm" disabled={busy} onClick={() => void run(() => markDefinitionCatalogVersion(definition.id, item.version))}>
              {t('Record as catalog v{n}', { n: item.version })}
            </Button>
          )}
          {canUpdate && (
            <Button size="sm" disabled={busy} onClick={() => void run(() => applyDefinitionCatalogUpdate(definition.id, item))}>
              {t('Update to v{n}', { n: item.version })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function firstLine(body: string): string {
  return body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) ?? '';
}

/** The connectors a catalog harness uses, marked by whether the Space has them. */
function ConnectorChips({ names, connected }: { names: string[]; connected: string[] }) {
  const { t } = useI18n();
  if (!names.length) return null;
  const have = new Set(connected.map((c) => c.trim().toLowerCase().replace(/\s+/g, '')));
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-muted-foreground">{t('Uses')}</span>
      {names.map((n) => (
        <span key={n} className={cn('rounded-full border border-[var(--border-default)] px-1.5 text-[11px]',
          have.has(n.toLowerCase().replace(/\s+/g, '')) ? 'text-[var(--text-secondary)]' : 'text-muted-foreground')}>
          {n}
        </span>
      ))}
    </div>
  );
}

/** The row's check slot, always in place: Passed, or the count of problems
 *  (errors, then warnings). Hints never dirty it. */
function CheckSummary({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const { t } = useI18n();
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length;
  return (
    <span className={cn('shrink-0 text-[11px]', errors ? 'text-[var(--status-danger)]' : warnings ? 'text-[var(--status-warning)]' : 'text-muted-foreground')}>
      {t('Check')}: {errors ? t('Problems: {count}', { count: errors }) : warnings ? t('Warnings: {count}', { count: warnings }) : t('Passed')}
    </span>
  );
}

const SEVERITY_CLASS: Record<Diagnostic['severity'], string> = {
  error: 'text-[var(--status-danger)]',
  warning: 'text-[var(--status-warning)]',
  hint: 'text-muted-foreground',
};

/** What the check found, as the person writes: each finding with how to fix it. */
function Diagnostics({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const { t } = useI18n();
  if (!diagnostics.length) return <p className="text-[12px] text-[var(--status-success)]">{t('No problems found.')}</p>;
  const label: Record<Diagnostic['severity'], string> = { error: t('Problem'), warning: t('Warning'), hint: t('Hint') };
  return (
    <ul className="space-y-1.5" aria-label={t('Check')}>
      {diagnostics.map((d, i) => (
        <li key={`${d.code}-${i}`} className="text-[12px] leading-relaxed">
          <span className={cn('mr-1.5 font-medium', SEVERITY_CLASS[d.severity])}>{label[d.severity]}</span>
          <span className="text-foreground">{d.message}</span>
          {d.fix && <span className="block text-muted-foreground">{d.fix}</span>}
        </li>
      ))}
    </ul>
  );
}

function HarnessEditor({ spaceId, definition, connected, isOwner, exceptions, onClose, onSaved }: {
  spaceId: string; definition: Definition | null; connected: string[]; isOwner: boolean;
  exceptions: { catalog: string[]; installed: string[] }; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(definition?.name ?? '');
  const [body, setBody] = useState(definition?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diagnostics = useMemo(() => checkHarness(parseDefinition(body), { connected, exceptions }), [body, connected, exceptions]);
  // Errors block saving (CLAUDE.md: a harness is checked as it is saved);
  // warnings and hints are shown but left to the person's judgment.
  const hasErrors = diagnostics.some((d) => d.severity === 'error');
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await f(); onSaved(); } catch (e) { setError(formatError(e)); setBusy(false); }
  };
  const save = () => run(() => (definition
    ? updateDefinition(definition.id, { name: name.trim(), body })
    : createDefinition({ spaceId, name, body })));
  const remove = () => {
    if (!definition || !window.confirm(t('Delete “{name}”? Strategies and Elements that follow it go back to the Space’s default.', { name: definition.name }))) return;
    void run(() => deleteDefinition(definition.id));
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{definition ? t('Edit harness') : t('New harness')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {definition && <p className="text-[11px] tabular-nums text-muted-foreground">{t('Updated')} {definition.updated_at.slice(0, 10)}</p>}
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Name')} className="h-8 text-[13px] md:text-[13px]" />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} spellCheck={false} className="font-mono text-[12px]"
            placeholder={'# 目的\n…\n# 進め方\n1. …\n# 止める条件\n- …\n# 使うコネクタ\n- GitHub\n# 成果物の型\n```md\n# …\n```'} />
          {body.trim() && <Diagnostics diagnostics={diagnostics} />}
          {definition && <CalibrationSection spaceId={spaceId} definitionId={definition.id} isOwner={isOwner} />}
          {definition && <ActiveConstraintsSection spaceId={spaceId} definitionId={definition.id} isOwner={isOwner} />}
          {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}
        </div>
        <DialogFooter>
          {definition && <Button variant="ghost" size="sm" className="mr-auto text-[var(--status-danger)]" onClick={remove} disabled={busy}>{t('Delete')}</Button>}
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>{t('Cancel')}</Button>
          <Button size="sm" onClick={() => void save()} disabled={busy || !name.trim() || !body.trim() || hasErrors}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The definition's calibration drill-down (B5): how its verifier's
 *  checked verdicts paired with people's eventual judgements over the
 *  trailing window — agree / false pass / false fail, the three
 *  numbers that answer "is my verifier lying to me on this
 *  definition" — and, when the tick evaluator has queued the
 *  definition for revision, the claim itself with the owner's two
 *  answers (the definition was revised, or the claim is dismissed).
 *  Nothing renders until pairs exist: calibration speaks only where
 *  a person judged the work, and silence below the data is the
 *  honest state, not a missing feature. Resolving goes through the
 *  owner-checked RPC; a member sees the claim but no buttons. */
function CalibrationSection({ spaceId, definitionId, isOwner }: {
  spaceId: string; definitionId: string; isOwner: boolean;
}) {
  const { t } = useI18n();
  const { calibration, candidate, loading, refetch } = useDefinitionCalibration(spaceId, definitionId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = calibrationSummaryOf(calibration);
  if (loading || (!summary && !candidate)) return null;
  const resolve = async (status: 'dismissed' | 'addressed') => {
    if (!candidate) return;
    setBusy(true); setError(null);
    try { await resolveRevisionCandidate(candidate.id, status); refetch(); }
    catch (e) { setError(formatError(e)); }
    setBusy(false);
  };
  return (
    <div className="space-y-2 rounded-md border border-[var(--border-default)] p-3">
      <div className="text-[11px] text-muted-foreground">{t('Verifier calibration')}</div>
      {summary && (
        <p className="text-[12px] tabular-nums text-foreground">
          {t('Agree {agree} · False pass {fp} · False fail {ff} — {n} paired results in the last {days} days', {
            agree: summary.agree, fp: summary.falsePass, ff: summary.falseFail, n: summary.pairs, days: summary.windowDays,
          })}
        </p>
      )}
      {candidate && (
        <div className="space-y-2">
          <p className="text-[12px] text-[var(--status-warning)]">
            {candidate.reason === 'false_pass_heavy'
              ? t('Queued for revision: this verifier passes work people send back ({errors} of {n} paired results, {rate}%).', {
                  errors: candidateErrorCount(candidate), n: candidate.pairs, rate: ratePercent(candidate.rate),
                })
              : candidate.reason === 'false_fail_heavy'
                ? t('Queued for revision: this verifier fails work people accept ({errors} of {n} paired results, {rate}%).', {
                    errors: candidateErrorCount(candidate), n: candidate.pairs, rate: ratePercent(candidate.rate),
                  })
                : t('Queued for revision.')}
          </p>
          {isOwner && (
            <div className="flex items-center gap-2">
              <Button size="xs" variant="secondary" disabled={busy} onClick={() => void resolve('addressed')}>{t('Mark addressed')}</Button>
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => void resolve('dismissed')}>{t('Dismiss')}</Button>
            </div>
          )}
          {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** The learned-constraints queue (B6): the lessons the tick's
 *  derivation drafted from this Space's outcome clusters, waiting for
 *  an owner's Activate / Reject. Each draft shows its text, its
 *  target, where the lesson came from, the baseline it claims it
 *  will move (the failure's rate over the target's recent runs) and
 *  how many outcomes stand as evidence — the decision minimum for
 *  "do I believe this lesson", and nothing else. Activation goes
 *  through the owner-checked, hash-bound RPC: if the target was
 *  edited after drafting, the RPC refuses and the error says why.
 *  The KPI line is the loop's own scoreboard: drafted / active /
 *  established / not helping. Nothing renders at all until the
 *  derivation has something to say. */
function ConstraintsSection({ spaceId, isOwner }: { spaceId: string | null; isOwner: boolean }) {
  const { t } = useI18n();
  const { drafts, constraints, loading, refetch } = useSpaceConstraintQueue(spaceId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!spaceId || (drafts.length === 0 && constraints.length === 0 && !loading)) return null;
  const kpi = constraintKpiOf(drafts, constraints);
  const derivedLabel = (d: (typeof drafts)[number]) =>
    d.derived_from === 'verifier_gap' ? t('From verifier gaps')
      : d.derived_from === 'rejection_cluster' ? t('From work people rejected')
      : t('From a repeated correction');
  const decide = async (id: string, act: 'activate' | 'reject') => {
    setBusyId(id); setError(null);
    try {
      if (act === 'activate') await activateConstraintDraft(id);
      else await rejectConstraintDraft(id);
      refetch();
    } catch (e) { setError(formatError(e)); }
    setBusyId(null);
  };
  return (
    <div className="space-y-2">
      <h3 className="text-[13px] font-medium text-foreground">{t('Learned constraints')}</h3>
      <p className="text-[11px] tabular-nums text-muted-foreground">
        {t('{proposed} drafted · {activated} active · {established} established · {ineffective} not helping', {
          proposed: kpi.proposed, activated: kpi.active, established: kpi.established, ineffective: kpi.ineffective,
        })}
      </p>
      <div>
        {drafts.map((d) => {
          const baseline = draftBaselineOf(d);
          return (
            <div key={d.id} className="-mx-2 flex w-[calc(100%+16px)] items-start gap-2 rounded-md px-2 py-2 transition-colors hover:bg-[var(--surface-strong)]">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-[13px] font-medium text-foreground">{d.constraint_text}</div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {d.targetName} · {derivedLabel(d)}
                </div>
                {baseline && (
                  <div className="text-[11px] tabular-nums text-muted-foreground">
                    {t('This failure showed in {with} of {total} runs ({rate}%)', {
                      with: baseline.withSignature, total: baseline.windowOutcomes, rate: baseline.ratePercent,
                    })}
                    {' · '}
                    {t('Evidence: {n} results', { n: d.evidence_outcome_ids.length })}
                    {d.expires_at ? ` · ${t('Review by {date}', { date: d.expires_at.slice(0, 10) })}` : ''}
                  </div>
                )}
              </div>
              {isOwner && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="xs" variant="secondary" disabled={busyId !== null} onClick={() => void decide(d.id, 'activate')}>{t('Activate')}</Button>
                  <Button size="xs" variant="ghost" disabled={busyId !== null} onClick={() => void decide(d.id, 'reject')}>{t('Reject')}</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}
    </div>
  );
}

/** A definition's active constraints (B6), in its editor: the rules
 *  currently layered over this body — rendered into its effective
 *  body at resolution, never written into the body itself — each with
 *  its scoreboard. A constraint whose failure is not going down is
 *  flagged here in warning tone; flagging is all the measurement
 *  does. Retiring one is the owner's act (Deactivate), here or
 *  nowhere — nothing retires a constraint on its own. */
function ActiveConstraintsSection({ spaceId, definitionId, isOwner }: {
  spaceId: string; definitionId: string; isOwner: boolean;
}) {
  const { t } = useI18n();
  const { constraints, loading, refetch } = useDefinitionConstraints(spaceId, definitionId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (loading || constraints.length === 0) return null;
  const retire = async (id: string) => {
    setBusyId(id); setError(null);
    try { await deactivatePlanningConstraint(id, 'owner'); refetch(); }
    catch (e) { setError(formatError(e)); }
    setBusyId(null);
  };
  return (
    <div className="space-y-2 rounded-md border border-[var(--border-default)] p-3">
      <div className="text-[11px] text-muted-foreground">{t('Active constraints')}</div>
      {constraints.map((c) => {
        const fx = constraintEffectOf(c);
        return (
          <div key={c.id} className="space-y-1">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-[12px] text-foreground">{c.constraint_text}</p>
              {isOwner && (
                <Button size="xs" variant="ghost" className="shrink-0" disabled={busyId !== null} onClick={() => void retire(c.id)}>{t('Deactivate')}</Button>
              )}
            </div>
            <p className={`text-[11px] tabular-nums ${fx.status === 'ineffective' ? 'text-[var(--status-warning)]' : 'text-muted-foreground'}`}>
              {fx.status === 'ineffective'
                ? t('Not helping — the failure it targets has not gone down ({with} of {under} runs under it; it was {rate}% before)', {
                    with: fx.withSignature, under: fx.under, rate: fx.baselinePercent,
                  })
                : fx.status === 'established'
                  ? t('Holding — the failure rate has stayed below where it started')
                  : fx.status === 'improving'
                    ? t('Helping — the failure is going down ({with} of {under} runs under it; it was {rate}% before)', {
                        with: fx.withSignature, under: fx.under, rate: fx.baselinePercent,
                      })
                    : t('Still measuring — {under} runs under it so far', { under: fx.under })}
            </p>
          </div>
        );
      })}
      {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}
    </div>
  );
}

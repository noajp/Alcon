'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ExternalLink, LayoutGrid, List, Search } from '@/ui/icons';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { CARD_FLAT, CARD_HOVER, FONT } from '@/shared/designTokens';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import type { Integration } from '@/types/database';
import {
  CATEGORY_LABELS, EMPTY_FILTER, INTEGRATION_PRESETS, INTEGRATION_STATUS_LABELS, KIND_LABELS, SOURCE_LABELS,
  filterPresets, installedPresetIds, integrationStatus, presetById, readLastTest, testOutcomeLabel,
  type CatalogFilter, type IntegrationPreset,
} from './catalog';
import { useIntegrations, useIsSpaceOwner } from './data';
import { createDraft, useIntegrationDrafts } from './draftData';
import { DRAFT_STATUS_LABELS, reconcileDraftWeb } from './draftModel';
import { IntegrationDraftDialog } from './IntegrationDraftDialog';
import { Textarea } from '@/ui/textarea';
import type { IntegrationDraft } from '@/types/database';
import { IntegrationIcon, SourceChip } from './IntegrationDetailDialog';
import { ConnectDialogHost, openedForIntegration, openedForPreset, openedForRegistryEntry, type OpenedConnection } from './ConnectDialogHost';
import { AlconConnectPanel } from './AlconConnectPanel';
import { AssetRelayPanel } from './AssetRelayPanel';
import { setOAuthOutcome, useOAuthOutcome } from './oauthReturn';
import { HarnessesPanel } from '@/AIP/harness/HarnessesPanel';
import { RegistrySection } from '@/AIP/harness/RegistrySection';
import { YoursDiscover, type CustomizeMode } from '@/AIP/harness/YoursDiscover';
import type { DirectoryEntry } from '@/hooks/customizeData';

// Settings › AI: how the Space's AI works.
//   definitions  harnesses — how a kind of work is carried out, the connectors
//                it uses and where it stops (HarnessesPanel)
//   external     connectors: Yours is the Space's connections; Discover is
//                Alcon's catalog (modelled on Supabase's Integrations page)
//                and the public MCP Registry (RegistrySection)
// Settings › API & access: the other direction.
//   alcon        point an MCP client or script at Alcon
//                with an OAuth sign-in or a personal access token
//                (AlconConnectPanel, ADR 0032 / 0034).
//   assets       the apps and AIs that joined the Space by adding one line to
//                their backend (AssetRelayPanel, ADR 0036).
// Members see everything read-only; only owners can connect or change.

const DOCS_URL = 'https://github.com/noajp/Alcon/blob/main/docs/mcp.md';

export function IntegrationsSettings({ tab }: { tab: string | null }) {
  return tab === 'alcon' ? <AlconConnectPanel />
    : tab === 'assets' ? <AssetRelayPanel />
    : tab === 'definitions' ? <HarnessesPanel />
    : tab === 'external' ? <ExternalServicesPanel />
    : <HarnessesPanel />;
}

function ExternalServicesPanel() {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: integrations, loading, error, refetch: refetchIntegrations } = useIntegrations(spaceId);
  const draftsQuery = useIntegrationDrafts(spaceId);
  const drafts = draftsQuery.data;
  const [openedDraftId, setOpenedDraftId] = useState<string | null>(null);
  const openedDraft = openedDraftId ? drafts.find((d) => d.id === openedDraftId) ?? null : null;
  const ownerRole = useIsSpaceOwner(spaceId);
  const isOwner = ownerRole === true;
  const [filter, setFilter] = useState<CatalogFilter>(EMPTY_FILTER);
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [opened, setOpened] = useState<OpenedConnection | null>(null);
  // Yours first: what the Space has, where a sign-in coming back lands too.
  const [mode, setMode] = useState<CustomizeMode>('yours');
  const oauthOutcome = useOAuthOutcome();
  const oauthReturnName = oauthOutcome?.integrationId ? integrations.find((i) => i.id === oauthOutcome.integrationId)?.name ?? null : null;
  // A confirmed sign-in changed the row (account, last test): read it again.
  const queryClient = useQueryClient();
  const oauthStatus = oauthOutcome?.status ?? null;
  useEffect(() => {
    if (oauthStatus === 'ok' || oauthStatus === 'error') void queryClient.invalidateQueries({ queryKey: ['integrations'] });
  }, [oauthStatus, queryClient]);

  const installed = useMemo(() => installedPresetIds(integrations), [integrations]);
  const visible = useMemo(() => filterPresets(INTEGRATION_PRESETS, filter), [filter]);

  const openPreset = (preset: IntegrationPreset) => setOpened(openedForPreset(preset, integrations));
  const openIntegration = (integration: Integration) => setOpened(openedForIntegration(integration));
  const connectedEndpoints = useMemo(() => new Set(integrations.map((i) => i.endpoint)), [integrations]);
  const addFromRegistry = (e: DirectoryEntry) => setOpened(openedForRegistryEntry(e));

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className={`${FONT.lg} text-foreground`}>{t('Connectors')}</h2>
        </div>
        <YoursDiscover mode={mode} onChange={setMode} />
        <Button asChild variant="ghost" size="sm">
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden="true" />
            <span>{t('Docs')}</span>
          </a>
        </Button>
      </div>

      {oauthOutcome && (
        <div role="status" className={cn('flex items-start justify-between gap-3 rounded-md px-3 py-2 text-[12px] text-foreground',
          oauthOutcome.status === 'ok' ? 'bg-[var(--status-success-subtle)]' : oauthOutcome.status === 'error' ? 'bg-[var(--status-danger-subtle)]' : 'bg-[var(--surface-strong)]')}>
          <span>
            {oauthOutcome.status === 'pending'
              ? t('Finishing sign-in…')
              : oauthOutcome.status === 'ok'
                ? oauthReturnName ? t('{name} is connected.', { name: oauthReturnName }) : t('Connected')
                : oauthOutcome.message
                  ? t(oauthOutcome.message)
                  : t('Sign-in did not finish, so nothing was connected. Try again.')}
          </span>
          {oauthOutcome.status !== 'pending' && (
            <Button variant="ghost" size="xs" onClick={() => setOAuthOutcome(null)}>{t('Dismiss')}</Button>
          )}
        </div>
      )}

      {ownerRole === false && (
        <p className="text-[12px] text-muted-foreground">{t('Only Space owners can connect or change integrations. You can see what is connected.')}</p>
      )}

      {mode === 'discover' && <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })}
              placeholder={t('Search integrations...')} aria-label={t('Search integrations...')} className="h-7 pl-8 text-[12px] md:text-[12px]" />
          </div>
          <FilterMenu label={t('Category')} value={filter.category} options={CATEGORY_LABELS} onChange={(category) => setFilter({ ...filter, category })} />
          <FilterMenu label={t('Type')} value={filter.kind} options={KIND_LABELS} onChange={(kind) => setFilter({ ...filter, kind })} />
          <FilterMenu label={t('Source')} value={filter.source} options={SOURCE_LABELS} onChange={(source) => setFilter({ ...filter, source })} />
          <div className="ml-auto flex gap-1" role="group" aria-label={t('Layout')}>
            <Button shape="tab" size="icon-sm" variant={layout === 'grid' ? 'secondary' : 'ghost'} aria-pressed={layout === 'grid'}
              aria-label={t('Grid')} onClick={() => setLayout('grid')}><LayoutGrid size={14} /></Button>
            <Button shape="tab" size="icon-sm" variant={layout === 'list' ? 'secondary' : 'ghost'} aria-pressed={layout === 'list'}
              aria-label={t('List')} onClick={() => setLayout('list')}><List size={14} /></Button>
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="py-3 text-[13px] text-muted-foreground">{t('No integrations match.')}</p>
        ) : layout === 'grid' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((p) => <PresetCard key={p.id} preset={p} installed={installed.has(p.id)} onOpen={() => openPreset(p)} />)}
          </div>
        ) : (
          <div>
            {visible.map((p) => <PresetRow key={p.id} preset={p} installed={installed.has(p.id)} onOpen={() => openPreset(p)} />)}
          </div>
        )}
      </section>}

      {mode === 'discover' && <RegistrySection connectedEndpoints={connectedEndpoints} canAdd={isOwner} onAdd={addFromRegistry} />}

      {mode === 'discover' && spaceId && (
        <DraftCreateSection
          spaceId={spaceId}
          integrations={integrations}
          drafts={drafts}
          onCreated={(draft) => { void draftsQuery.refetch(); setOpenedDraftId(draft.id); }}
          onOpenDraft={(draft) => setOpenedDraftId(draft.id)}
        />
      )}

      {mode === 'yours' && <section className="space-y-3">
        <h3 className={FONT.label}>{t('Installed connections')}</h3>
        {error ? (
          <p className="text-[12px] text-[var(--status-danger)]">{t("Couldn't load integrations: {error}", { error: error.message })}</p>
        ) : loading ? (
          <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>
        ) : integrations.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{t('Nothing is connected to this Space yet.')}</p>
        ) : (
          <div>
            {integrations.map((i) => <ConnectedRow key={i.id} integration={i} onOpen={() => openIntegration(i)} />)}
          </div>
        )}
      </section>}

      {mode === 'yours' && drafts.length > 0 && (
        <section className="space-y-3">
          <h3 className={FONT.label}>{t('Drafted connections')}</h3>
          <div>
            {drafts.map((d) => (
              <button key={d.id} type="button" onClick={() => setOpenedDraftId(d.id)}
                className="-mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-[var(--surface-strong)] focus-visible:bg-[var(--surface-strong)]">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-foreground">{d.name}</div>
                  <div className="truncate text-[12px] text-muted-foreground">{d.endpoint ?? t('No definition yet')}</div>
                </div>
                <span className={cn('inline-flex shrink-0 items-center text-[11px]',
                  d.status === 'awaiting_review' ? 'text-[var(--status-warning)]' : d.status === 'active' ? 'text-[var(--status-success)]' : 'text-muted-foreground')}>
                  {t(DRAFT_STATUS_LABELS[d.status])}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {openedDraft && spaceId && (
        <IntegrationDraftDialog
          draft={openedDraft}
          spaceId={spaceId}
          integrations={integrations}
          canReview={isOwner}
          onClose={() => setOpenedDraftId(null)}
          onChanged={() => { void draftsQuery.refetch(); void refetchIntegrations(); }}
        />
      )}

      {opened && spaceId && (
        <ConnectDialogHost
          spaceId={spaceId}
          opened={opened}
          integrations={integrations}
          canEdit={isOwner}
          onClose={() => setOpened(null)}
          onCreated={(created) => { setMode('yours'); setOpened({ preset: opened.preset, integration: created }); }}
        />
      )}
    </div>
  );
}

function FilterMenu<K extends string>({ label, value, options, onChange }: {
  label: string; value: K | null; options: Record<K, string>; onChange: (v: K | null) => void;
}) {
  const { t } = useI18n();
  const keys = Object.keys(options) as K[];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={value ? 'secondary' : 'ghost'} size="sm" align="start">
          <span>{value ? `${label}: ${t(options[value])}` : label}</span>
          <ChevronDown size={12} aria-hidden="true" className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        <DropdownMenuItem onSelect={() => onChange(null)} className="gap-2 text-[12px]">
          <span className="flex-1">{t('All')}</span>
          {value === null && <Check size={12} />}
        </DropdownMenuItem>
        {keys.map((k) => (
          <DropdownMenuItem key={k} onSelect={() => onChange(k)} className="gap-2 text-[12px]">
            <span className="flex-1">{t(options[k])}</span>
            {value === k && <Check size={12} />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InstalledBadge() {
  const { t } = useI18n();
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-[var(--status-success-subtle)] px-2 text-[11px] font-medium text-[var(--status-success)]">
      {t('Installed')}
    </span>
  );
}

function PresetCard({ preset, installed, onOpen }: {
  preset: IntegrationPreset; installed: boolean; onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onOpen}
      className={cn(CARD_FLAT, CARD_HOVER, 'flex min-h-[156px] flex-col gap-3 p-4 text-left outline-none focus-visible:bg-[var(--surface-strong)]')}>
      <div className="flex items-start justify-between gap-2">
        <IntegrationIcon name={preset.name} icon={preset.icon} size={32} />
        {installed && !preset.custom && <InstalledBadge />}
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">{t(preset.name)}</div>
        <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{t(preset.description)}</p>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        <SourceChip source={preset.source} />
        <span className="truncate text-[11px] text-muted-foreground">{t('Built by {name}', { name: t(preset.builtBy) })}</span>
      </div>
    </button>
  );
}

function PresetRow({ preset, installed, onOpen }: { preset: IntegrationPreset; installed: boolean; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onOpen}
      className="-mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-[var(--surface-strong)] focus-visible:bg-[var(--surface-strong)]">
      <IntegrationIcon name={preset.name} icon={preset.icon} size={24} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">{t(preset.name)}</div>
        <p className="truncate text-[12px] text-muted-foreground">{t(preset.description)}</p>
      </div>
      {installed && !preset.custom && <InstalledBadge />}
      <SourceChip source={preset.source} />
    </button>
  );
}

function ConnectedRow({ integration, onOpen }: { integration: Integration; onOpen: () => void }) {
  const { t } = useI18n();
  const last = readLastTest(integration.last_test);
  return (
    <button type="button" onClick={onOpen}
      className="-mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-[var(--surface-strong)] focus-visible:bg-[var(--surface-strong)]">
      <IntegrationIcon name={integration.name} icon={integration.icon ?? presetById(integration.preset)?.icon ?? null} size={24} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">{integration.name}</span>
        </div>
        <div className="truncate text-[12px] text-muted-foreground">
          {[
            t(KIND_LABELS[integration.kind]),
            last?.toolCount != null ? t('{count} tools', { count: last.toolCount }) : null,
          ].filter(Boolean).join(' · ')}
        </div>
      </div>
      <StatusChip integration={integration} />
    </button>
  );
}

/** Entry C (G4): ask the AI to draft a connection for a service the
 *  catalog and the Registry do not have. The reconcile runs in the open
 *  as the person types — a name that already has a route is never
 *  drafted around, here or on the server (which reconciles again). */
function DraftCreateSection({ spaceId, integrations, drafts, onCreated, onOpenDraft }: {
  spaceId: string;
  integrations: Integration[];
  drafts: IntegrationDraft[];
  onCreated: (draft: IntegrationDraft) => void;
  onOpenDraft: (draft: IntegrationDraft) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [docsUrl, setDocsUrl] = useState('');
  const [purpose, setPurpose] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const knownHost = useMemo(() => {
    try { return docsUrl.trim() ? new URL(docsUrl.trim()).hostname : null; } catch { return null; }
  }, [docsUrl]);
  const outcome = useMemo(
    () => (name.trim() ? reconcileDraftWeb({ name, integrations, drafts, knownHost }) : null),
    [name, integrations, drafts, knownHost],
  );
  const existingDraft = outcome?.kind === 'join' ? drafts.find((d) => d.id === outcome.draftId) ?? null : null;
  const canStart = !!name.trim() && !!purpose.trim() && !starting
    && (outcome?.kind === 'create' || outcome?.kind === 'update');

  const start = async () => {
    if (!canStart) return;
    setStarting(true); setStartError(null);
    try {
      const draft = await createDraft(spaceId, {
        name, purpose: purpose.trim(), docsUrl: docsUrl.trim() || null, entry: 'settings',
      }, drafts);
      setName(''); setDocsUrl(''); setPurpose('');
      onCreated(draft);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className={FONT.label}>{t('Have the AI draft it')}</h3>
        <p className="mt-1 max-w-xl text-[12px] text-muted-foreground">
          {t('For a service with a public API that is not in the catalog: the AI reads the official documentation, drafts the connection definition and tests it. An owner reviews and activates it — nothing connects on its own.')}
        </p>
      </div>
      <div className="grid max-w-xl gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Service name')}
          aria-label={t('Service name')} className="h-8 text-[13px] md:text-[13px]" />
        <Input value={docsUrl} onChange={(e) => setDocsUrl(e.target.value)} placeholder={t('Documentation URL (optional)')}
          aria-label={t('Documentation URL (optional)')} className="h-8 text-[13px] md:text-[13px]" />
        <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)}
          placeholder={t('What will you use it for? e.g. Look up orders and reply to inquiries')}
          aria-label={t('What will you use it for?')} className="min-h-16 text-[13px] md:text-[13px]" />
      </div>
      {outcome?.kind === 'connected' && (
        <p className="text-[12px] text-muted-foreground">{t('Already connected — no draft needed.')}</p>
      )}
      {outcome?.kind === 'preset' && (
        <p className="text-[12px] text-muted-foreground">{t('This service has a built-in connection in the catalog above.')}</p>
      )}
      {outcome?.kind === 'registry' && (
        <p className="text-[12px] text-muted-foreground">{t('This service is listed in the MCP Registry above.')}</p>
      )}
      {outcome?.kind === 'update' && (
        <p className="text-[12px] text-muted-foreground">{t('A connection with this name exists. The draft will update its definition instead; the live connection is not touched until activation.')}</p>
      )}
      {existingDraft && (
        <p className="text-[12px] text-muted-foreground">
          {t('A draft for this service is already open.')}{' '}
          <button type="button" className="underline underline-offset-2" onClick={() => onOpenDraft(existingDraft)}>
            {t('Open the draft')}
          </button>
        </p>
      )}
      {startError && <p className="text-[12px] text-[var(--status-danger)]">{startError}</p>}
      <Button size="sm" onClick={() => void start()} disabled={!canStart}>
        {starting ? t('Starting…') : t('Start drafting')}
      </Button>
    </section>
  );
}

/** The row's one status word (off / not tested / connected / reachable /
 *  action needed); the dialog carries the test's detail. */
function StatusChip({ integration }: { integration: Integration }) {
  const { t } = useI18n();
  const status = integrationStatus(integration);
  const last = readLastTest(integration.last_test);
  return (
    <span
      title={last ? t(testOutcomeLabel(last.code)) : undefined}
      className={cn('inline-flex shrink-0 items-center text-[11px]',
        status === 'connected' ? 'text-[var(--status-success)]' : status === 'action-needed' ? 'text-[var(--status-danger)]' : 'text-muted-foreground')}
    >
      {t(INTEGRATION_STATUS_LABELS[status])}
    </span>
  );
}

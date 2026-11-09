'use client';

import { formatError } from '@/Function/shared/formatError';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from '@/ui/icons';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { CARD_FLAT, CARD_HOVER, FONT } from '@/shared/designTokens';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import type { Integration } from '@/types/database';
import {
  CONNECTION_METHOD_ORDER, INTEGRATION_PRESETS, INTEGRATION_STATUS_LABELS, KIND_LABELS, OAUTH_PROVIDER_NAMES,
  catalogGroups, connectionMethodOf, installedPresetIds, integrationStatus, oauthProviderOf, presetById, readLastTest, testOutcomeLabel,
  type CatalogCardState, type ConnectionMethod, type IntegrationPreset, type OAuthProvider,
} from './catalog';
import { useIntegrationOAuthStatus, useIntegrations, useIsSpaceOwner } from './data';
import { setSpaceApprovalMode, useSpaceApprovalMode } from './approvalModeData';
import { APPROVAL_MODE_DESCRIPTIONS, APPROVAL_MODE_LABELS, APPROVAL_MODE_ORDER, approvalModeOf, type ApprovalMode } from './approvalModeModel';
import { createDraft, useIntegrationDrafts } from './draftData';
import { DRAFT_STATUS_LABELS, reconcileDraftWeb } from './draftModel';
import { IntegrationDraftDialog } from './IntegrationDraftDialog';
import { SiteCredentialsSection } from './SiteCredentialsSection';
import { Textarea } from '@/ui/textarea';
import type { IntegrationDraft } from '@/types/database';
import { IntegrationIcon } from './IntegrationDetailDialog';
import { ConnectDialogHost, openedForIntegration, openedForPreset, openedForRegistryEntry, type OpenedConnection } from './ConnectDialogHost';
import { AlconConnectPanel } from './AlconConnectPanel';
import { AssetRelayPanel } from './AssetRelayPanel';
import { setOAuthOutcome, useOAuthOutcome } from './oauthReturn';
import { HarnessesPanel } from '@/AIP/harness/HarnessesPanel';
import { RegistrySection } from '@/AIP/harness/RegistrySection';
import type { DirectoryEntry } from '@/hooks/customizeData';

// Settings › AI: how the Space's AI works.
//   definitions  harnesses — how a kind of work is carried out, the connectors
//                it uses and where it stops (HarnessesPanel)
//   external     connectors: one page — what the Space has (Connected,
//                site logins, drafts), then what it can add, grouped by
//                how a connection is made, and the public MCP Registry
//                (RegistrySection)
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
  const [opened, setOpened] = useState<OpenedConnection | null>(null);
  const [siteLoginAddOpen, setSiteLoginAddOpen] = useState(false);
  // Sign-in readiness is the server's fact, shared with the detail
  // dialog: both provider reads sit on the one status fetch.
  const googleConfigured = useIntegrationOAuthStatus(true, 'google');
  const githubConfigured = useIntegrationOAuthStatus(true, 'github');
  const oauthOutcome = useOAuthOutcome();
  const oauthReturnName = oauthOutcome?.integrationId ? integrations.find((i) => i.id === oauthOutcome.integrationId)?.name ?? null : null;
  // A confirmed sign-in changed the row (account, last test): read it again.
  const queryClient = useQueryClient();
  const oauthStatus = oauthOutcome?.status ?? null;
  useEffect(() => {
    if (oauthStatus === 'ok' || oauthStatus === 'error') void queryClient.invalidateQueries({ queryKey: ['integrations'] });
  }, [oauthStatus, queryClient]);

  const installed = useMemo(() => installedPresetIds(integrations), [integrations]);
  const oauthConfigured = useMemo<Record<OAuthProvider, boolean | null>>(
    () => ({ google: googleConfigured, github: githubConfigured }),
    [googleConfigured, githubConfigured],
  );
  const groups = useMemo(
    () => catalogGroups(INTEGRATION_PRESETS, installed, oauthConfigured),
    [installed, oauthConfigured],
  );

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

      {spaceId && <ApprovalModeSection spaceId={spaceId} isOwner={isOwner} />}

      <section className="space-y-3">
        <h3 className={FONT.label}>{t('Connected')}</h3>
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
      </section>

      {spaceId && (
        <SiteCredentialsSection spaceId={spaceId} integrations={integrations} isOwner={isOwner} ownerKnown={ownerRole !== null}
          addOpen={siteLoginAddOpen} onAddOpenChange={setSiteLoginAddOpen} />
      )}

      {drafts.length > 0 && (
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

      {(groups.length > 0 || isOwner) && <section className="space-y-3">
        <h3 className={FONT.label}>{t('Add a connection')}</h3>
        <div className="space-y-6">
          {CONNECTION_METHOD_ORDER.map((method) => {
            const group = groups.find((g) => g.method === method);
            const showSiteCard = method === 'sign-in' && isOwner;
            if (!group && !showSiteCard) return null;
            return (
              <div key={method} className="space-y-3">
                <h4 className={FONT.label}>{t(CONNECTION_METHOD_HEADINGS[method])}</h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group?.cards.map(({ preset, state }) => (
                    <PresetCard key={preset.id} preset={preset} state={state} onOpen={() => openPreset(preset)} />
                  ))}
                  {showSiteCard && <WebsiteSignInCard onOpen={() => setSiteLoginAddOpen(true)} />}
                </div>
              </div>
            );
          })}
        </div>
      </section>}

      <RegistrySection connectedEndpoints={connectedEndpoints} canAdd={isOwner} onAdd={addFromRegistry} />

      {spaceId && (
        <DraftCreateSection
          spaceId={spaceId}
          integrations={integrations}
          drafts={drafts}
          onCreated={(draft) => { void draftsQuery.refetch(); setOpenedDraftId(draft.id); }}
          onOpenDraft={(draft) => setOpenedDraftId(draft.id)}
        />
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
          onCreated={(created) => setOpened({ preset: opened.preset, integration: created })}
        />
      )}
    </div>
  );
}

/** The Space's approval mode: how Athena's writes are held. A policy
 *  layer above every connection's own permissions and delegation — it
 *  changes how an ask is handled, never what is allowed (a "Not allowed"
 *  command stays refused in every mode, and a connection's test, its
 *  secret and a drafted connection's activation never read it). Owners
 *  change it through the one RPC, which records the change; a run keeps
 *  the mode it started under, and what already waits is never approved
 *  by a change. Under Free action, what would have asked runs and is
 *  recorded as a policy approval instead. */
function ApprovalModeSection({ spaceId, isOwner }: { spaceId: string; isOwner: boolean }) {
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

/** The method groups' headings: how the connection is made, in plain words. */
const CONNECTION_METHOD_HEADINGS: Record<ConnectionMethod, string> = {
  'sign-in': 'Connect by signing in',
  'token': 'Connect with a token',
  'custom': 'Set up a custom connection',
};

/** A catalog card whose bottom line is the next action — how this
 *  connection is made — not provider metadata (Source and builder live
 *  in the detail dialog, the drill-down). A sign-in preset whose
 *  provider is not configured on the server reads as setup-needed,
 *  never as a broken connect; it still opens the dialog, which carries
 *  the full administrator copy. */
function PresetCard({ preset, state, onOpen }: {
  preset: IntegrationPreset; state: CatalogCardState; onOpen: () => void;
}) {
  const { t } = useI18n();
  const method = connectionMethodOf(preset);
  const provider = oauthProviderOf(preset);
  const action = state === 'setup-needed'
    ? t('Needs setup')
    : method === 'sign-in'
      ? t('Sign in with {provider}', { provider: OAUTH_PROVIDER_NAMES[provider!] })
      : method === 'token'
        ? t('Paste a token')
        : t('Set up');
  return (
    <button type="button" onClick={onOpen}
      className={cn(CARD_FLAT, CARD_HOVER, 'flex min-h-[156px] flex-col gap-3 p-4 text-left outline-none focus-visible:bg-[var(--surface-strong)]')}>
      <div className="flex items-start justify-between gap-2">
        <IntegrationIcon name={preset.name} icon={preset.icon} size={32} />
        {state === 'setup-needed' && (
          <span className="inline-flex h-5 items-center rounded-full bg-[var(--status-warning-subtle)] px-2 text-[11px] font-medium text-[var(--status-warning)]">
            {t('Needs setup')}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">{t(preset.name)}</div>
        <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{t(preset.description)}</p>
      </div>
      <div className="mt-auto">
        <div className="text-[12px] font-medium text-foreground">{action}</div>
        {state === 'setup-needed' && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t('Sign-in is not set up on this server yet.')}</p>
        )}
      </div>
    </button>
  );
}

/** The website sign-in entry (secure login's browser route): not a
 *  preset — it opens the Site logins section's add dialog, the one
 *  route to a site credential. Shown to owners, like that section's
 *  own add button. */
function WebsiteSignInCard({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onOpen}
      className={cn(CARD_FLAT, CARD_HOVER, 'flex min-h-[156px] flex-col gap-3 p-4 text-left outline-none focus-visible:bg-[var(--surface-strong)]')}>
      <IntegrationIcon name={t('Website sign-in')} icon={null} size={32} />
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">{t('Website sign-in')}</div>
        <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{t('For a website with no API: Athena signs in with a login you save.')}</p>
      </div>
      <div className="mt-auto text-[12px] font-medium text-foreground">{t('Add site login')}</div>
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
      setStartError(formatError(e));
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

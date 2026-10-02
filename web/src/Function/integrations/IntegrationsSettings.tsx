'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Copy, ExternalLink, LayoutGrid, List, Search } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { CARD, CARD_HOVER } from '@/shared/designTokens';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import type { Integration } from '@/types/database';
import {
  CATEGORY_LABELS, EMPTY_FILTER, INTEGRATION_PRESETS, KIND_LABELS, SOURCE_LABELS,
  filterPresets, installedPresetIds, presetById, readLastTest,
  type CatalogFilter, type IntegrationPreset,
} from './catalog';
import { useIntegrations, useIsSpaceOwner } from './data';
import { IntegrationDetailDialog, IntegrationIcon, SourceChip } from './IntegrationDetailDialog';

// Settings › Integrations (ADR 0027). Two tabs:
//   external  connect a Space's external services so agents can use them on
//             Elements — a catalog modelled on Supabase's Integrations page,
//             then the Space's connections.
//   alcon     the other direction: point an MCP client at Alcon.
// Members see everything read-only; only owners can connect or change.

const DOCS_URL = 'https://github.com/noajp/Alcon/blob/main/docs/mcp.md';
// Derived from the project this build talks to, so preview and local builds
// show their own addresses.
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
const ALCON_MCP_URL = `${SUPABASE_URL}/functions/v1/alcon-mcp`;
const AUTH_STORAGE_KEY = `sb-${SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0]}-auth-token`;

export function IntegrationsSettings({ tab }: { tab: string | null }) {
  return tab === 'alcon' ? <AlconConnectPanel /> : <ExternalServicesPanel />;
}

type Opened = { preset: IntegrationPreset; integration: Integration | null } | null;

function ExternalServicesPanel() {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: integrations, loading, error } = useIntegrations(spaceId);
  const ownerRole = useIsSpaceOwner(spaceId);
  const isOwner = ownerRole === true;
  const [filter, setFilter] = useState<CatalogFilter>(EMPTY_FILTER);
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [opened, setOpened] = useState<Opened>(null);

  const installed = useMemo(() => installedPresetIds(integrations), [integrations]);
  const visible = useMemo(() => filterPresets(INTEGRATION_PRESETS, filter), [filter]);
  const featured = INTEGRATION_PRESETS.filter((p) => p.featured);
  const filtering = filter !== EMPTY_FILTER && (filter.query.trim() !== '' || !!filter.category || !!filter.kind || !!filter.source);

  // A fixed preset opens its existing connection; a custom one always starts a new one.
  const openPreset = (preset: IntegrationPreset) => {
    const existing = preset.custom ? null : integrations.find((i) => i.preset === preset.id) ?? null;
    setOpened({ preset, integration: existing });
  };
  const openIntegration = (integration: Integration) => {
    const preset = presetById(integration.preset) ?? presetById(integration.kind === 'mcp' ? 'custom-mcp' : 'custom-http')!;
    setOpened({ preset, integration });
  };
  // Keep the open dialog on the live row (test results, optimistic edits);
  // while a disconnect is in flight the row is gone from the list, so the
  // dialog holds the row it opened with.
  const openedIntegration = opened?.integration ? integrations.find((i) => i.id === opened.integration!.id) ?? null : null;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-foreground">{t('Connect apps')}</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {t('Connect external services and AI agents can use them while working on Elements. Writes to an external service wait for your approval every time by default.')}
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden="true" />
            <span>{t('Docs')}</span>
          </a>
        </Button>
      </div>

      {ownerRole === false && (
        <p className="text-[12px] text-muted-foreground">{t('Only Space owners can connect or change integrations. You can see what is connected.')}</p>
      )}

      {!filtering && (
        <section className="space-y-3">
          <h3 className="text-[13px] font-medium text-foreground">{t('Featured')}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            {featured.map((p, i) => (
              <PresetCard key={p.id} preset={p} installed={installed.has(p.id)} featured
                className={i === 0 ? 'sm:col-span-2' : undefined} onOpen={() => openPreset(p)} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
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
          <p className="py-8 text-center text-[12px] text-muted-foreground">{t('No integrations match.')}</p>
        ) : layout === 'grid' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((p) => <PresetCard key={p.id} preset={p} installed={installed.has(p.id)} onOpen={() => openPreset(p)} />)}
          </div>
        ) : (
          <div className="divide-y divide-border/40 rounded-lg border border-border/60">
            {visible.map((p) => <PresetRow key={p.id} preset={p} installed={installed.has(p.id)} onOpen={() => openPreset(p)} />)}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-[13px] font-medium text-foreground">{t('Connected')}</h3>
        {error ? (
          <p className="text-[12px] text-[var(--status-danger)]">{t("Couldn't load integrations")}: {error.message}</p>
        ) : loading ? (
          <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>
        ) : integrations.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{t('Nothing is connected to this Space yet.')}</p>
        ) : (
          <div className="divide-y divide-border/40 rounded-lg border border-border/60">
            {integrations.map((i) => <ConnectedRow key={i.id} integration={i} onOpen={() => openIntegration(i)} />)}
          </div>
        )}
      </section>

      {opened && spaceId && (
        <IntegrationDetailDialog
          key={opened.integration?.id ?? opened.preset.id}
          spaceId={spaceId}
          preset={opened.preset}
          integration={opened.integration ? openedIntegration ?? opened.integration : null}
          canEdit={isOwner}
          onClose={() => setOpened(null)}
          onCreated={(created) => setOpened({ preset: opened.preset, integration: created })}
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

function PresetCard({ preset, installed, featured = false, className, onOpen }: {
  preset: IntegrationPreset; installed: boolean; featured?: boolean; className?: string; onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onOpen}
      className={cn(CARD, CARD_HOVER, 'flex flex-col gap-3 p-4 text-left outline-none focus-visible:bg-[var(--surface-strong)]', featured ? 'min-h-[176px]' : 'min-h-[156px]', className)}>
      <div className="flex items-start justify-between gap-2">
        <IntegrationIcon name={preset.name} icon={preset.icon} size={featured ? 40 : 32} />
        {installed && !preset.custom && <InstalledBadge />}
      </div>
      <div className="min-w-0">
        <div className={cn('font-semibold text-foreground', featured ? 'text-[15px]' : 'text-[13px]')}>{t(preset.name)}</div>
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
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-[var(--surface-strong)] focus-visible:bg-[var(--surface-strong)]">
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
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-[var(--surface-strong)] focus-visible:bg-[var(--surface-strong)]">
      <IntegrationIcon name={integration.name} icon={integration.icon} size={24} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">{integration.name}</span>
          {!integration.enabled && <span className="text-[11px] text-muted-foreground">{t('Off')}</span>}
        </div>
        <div className="truncate text-[12px] text-muted-foreground">
          {[
            KIND_LABELS[integration.kind],
            integration.delegation === 'full_delegation' ? t('Full delegation') : t('Approve each time'),
            last?.toolCount != null ? t('{count} tools', { count: last.toolCount }) : null,
          ].filter(Boolean).join(' · ')}
        </div>
      </div>
      <TestStatus integration={integration} />
    </button>
  );
}

function TestStatus({ integration }: { integration: Integration }) {
  const { t } = useI18n();
  const last = readLastTest(integration.last_test);
  if (!last) return <span className="shrink-0 text-[11px] text-muted-foreground">{t('Not tested')}</span>;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-[11px]', last.ok ? 'text-[var(--status-success)]' : 'text-[var(--status-danger)]')}>
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', last.ok ? 'bg-[var(--status-success)]' : 'bg-[var(--status-danger)]')} />
      {last.ok ? t('Connected') : t('Error')}
    </span>
  );
}

// ── Alcon へ接続する ────────────────────────────────────────────────────────

function AlconConnectPanel() {
  const { t } = useI18n();
  const command = `claude mcp add --transport http alcon "${ALCON_MCP_URL}?client=Claude%20Code" --header "Authorization: Bearer <access_token>"`;
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">{t('Connect to Alcon')}</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {t("Alcon is an MCP server. Point an MCP client at it and the client can read and update this board within your permissions.")}
        </p>
      </div>

      <section className="space-y-2">
        <h3 className="text-[13px] font-medium text-foreground">{t('Endpoint')}</h3>
        <CopyField value={ALCON_MCP_URL} />
      </section>

      <section className="space-y-2">
        <h3 className="text-[13px] font-medium text-foreground">Claude Code</h3>
        <ol className="list-decimal space-y-2 pl-5 text-[12px] text-muted-foreground">
          <li>{t('In a signed-in Alcon tab, open DevTools and copy access_token from the localStorage entry {key}.', { key: AUTH_STORAGE_KEY })}</li>
          <li>{t('Run this command, replacing <access_token> with it:')}</li>
        </ol>
        <CopyField value={command} multiline />
        <p className="text-[12px] text-muted-foreground">{t('The access token expires after an hour. When requests start failing, run the command again with a new token.')}</p>
      </section>

      <p className="rounded-lg border border-border/60 bg-[var(--surface-rail)]/40 px-4 py-3 text-[12px] text-muted-foreground">
        {t('Coming next: OAuth for claude.ai and ChatGPT connectors, and personal access tokens.')}
      </p>
    </div>
  );
}

function CopyField({ value, multiline = false }: { value: string; multiline?: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable; the text stays selectable */ }
  };
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-[var(--surface-rail)]/40 px-3 py-2">
      <code className={cn('min-w-0 flex-1 select-all font-mono text-[12px] text-foreground', multiline ? 'whitespace-pre-wrap break-all' : 'truncate')}>{value}</code>
      <Button variant="ghost" size="icon-xs" aria-label={copied ? t('Copied') : t('Copy')} onClick={copy}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </Button>
    </div>
  );
}

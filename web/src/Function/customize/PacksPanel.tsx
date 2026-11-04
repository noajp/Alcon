'use client';

import { useState } from 'react';
import { Button } from '@/ui/button';
import { CARD, FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { setActiveSettingsSection } from '@/Function/settings/settingsNav';
import { createDefinition, useDefinitions } from '@/hooks/definitionData';
import { useCatalog, type CatalogPack, type PackConnector } from '@/hooks/customizeData';
import { useIntegrations } from '@/Function/integrations/data';
import { presetById } from '@/Function/integrations/catalog';
import type { Integration } from '@/types/database';
import { YoursDiscover, type CustomizeMode } from './YoursDiscover';

// Settings › Customize › Packs: what a kind of work needs, in one place — the
// definitions it is carried out by and the connectors it uses. Adding a pack
// adds its definitions to the Space's library; its connectors are listed with
// whether the Space has them, since connecting one takes a person's sign-in
// or key. Yours shows the packs whose definitions the Space has.

function connectorOf(c: PackConnector, integrations: Integration[]): { label: string; connected: boolean } {
  if ('preset' in c) {
    const preset = presetById(c.preset);
    return { label: preset?.name ?? c.preset, connected: integrations.some((i) => i.preset === c.preset) };
  }
  return { label: c.title ?? c.registry, connected: integrations.some((i) => i.name === (c.title ?? c.registry)) };
}

export function PacksPanel() {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const catalog = useCatalog();
  const library = useDefinitions(spaceId);
  const { data: integrations } = useIntegrations(spaceId);
  const [mode, setMode] = useState<CustomizeMode>('yours');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const have = new Set(library.data.map((d) => d.source_id).filter(Boolean));
  const definitionName = new Map(catalog.definitions.map((d) => [d.id, d.name]));
  const isAdded = (p: CatalogPack) => p.definitions.length > 0 && p.definitions.every((d) => have.has(d));
  const shown = mode === 'yours' ? catalog.packs.filter(isAdded) : catalog.packs;

  const add = async (pack: CatalogPack) => {
    if (!spaceId) return;
    setBusy(pack.id); setError(null);
    try {
      for (const id of pack.definitions) {
        if (have.has(id)) continue;
        const item = catalog.definitions.find((d) => d.id === id);
        if (item) await createDefinition({ spaceId, name: item.name, body: item.body, sourceId: item.id });
      }
      await library.refetch();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`${FONT.lg} text-foreground`}>{t('Packs')}</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">{t('What a kind of work needs, together: the definitions it follows and the connectors it uses.')}</p>
        </div>
        <YoursDiscover mode={mode} onChange={setMode} />
      </div>
      {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}
      {catalog.loading ? <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>
        : shown.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{mode === 'yours' ? t('No packs added yet. Find one in Discover.') : t('No packs yet.')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {shown.map((p) => {
              const added = isAdded(p);
              const connectors = p.connectors.map((c) => connectorOf(c, integrations));
              return (
                <div key={p.id} className={`${CARD} flex flex-col gap-3 p-4`}>
                  <div>
                    <div className="text-[13px] font-semibold text-foreground">{p.name}</div>
                    <p className="mt-1 text-[12px] text-muted-foreground">{p.description}</p>
                  </div>
                  <div className="space-y-1 text-[12px]">
                    <div className="text-muted-foreground">{t('Definitions')}</div>
                    {p.definitions.map((d) => (
                      <div key={d} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-foreground">{definitionName.get(d) ?? d}</span>
                        {have.has(d) && <span className="text-[11px] text-[var(--status-success)]">{t('Added')}</span>}
                      </div>
                    ))}
                    {connectors.length > 0 && <div className="pt-1 text-muted-foreground">{t('Connectors')}</div>}
                    {connectors.map((c) => (
                      <div key={c.label} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-foreground">{c.label}</span>
                        <span className={c.connected ? 'text-[11px] text-[var(--status-success)]' : 'text-[11px] text-muted-foreground'}>
                          {c.connected ? t('Connected') : t('Not connected')}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-auto flex items-center gap-2">
                    {connectors.some((c) => !c.connected) && (
                      <Button size="xs" variant="ghost" onClick={() => setActiveSettingsSection('integrations', 'external')}>{t('Open Connectors')}</Button>
                    )}
                    {added
                      ? <span className="ml-auto text-[11px] text-[var(--status-success)]">{t('Added')}</span>
                      : <Button size="xs" variant="secondary" className="ml-auto" onClick={() => void add(p)} disabled={busy !== null || !spaceId}>{busy === p.id ? t('Adding…') : t('Add')}</Button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

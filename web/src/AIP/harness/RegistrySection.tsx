'use client';

import { useEffect, useState } from 'react';
import { Search } from '@/ui/icons';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { CARD, FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useConnectorDirectory, type DirectoryEntry } from '@/hooks/customizeData';
import { IntegrationIcon } from '@/AIP/connectors/IntegrationDetailDialog';

// The public MCP registry, searched: every server that runs remotely, ready
// to add as a custom MCP connection with its endpoint and sign-in filled in.
// Adding opens the usual connection dialog; once connected, the connection
// test lists its tools and turns them into the commands agents may use.

export function RegistrySection({ connectedEndpoints, canAdd, onAdd }: {
  connectedEndpoints: Set<string>;
  canAdd: boolean;
  onAdd: (entry: DirectoryEntry) => void;
}) {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const id = setTimeout(() => setQ(input.trim()), 350); return () => clearTimeout(id); }, [input]);
  const directory = useConnectorDirectory(q, true);

  return (
    <section className="space-y-3">
      <div>
        <h3 className={`${FONT.lg} text-foreground`}>{t('From the MCP Registry')}</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">{t('Servers listed in the public MCP Registry that run remotely. Anyone can list a server there, so add only ones you trust.')}</p>
      </div>
      <div className="relative">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('Search the registry…')} aria-label={t('Search the registry…')}
          className="h-7 pl-8 text-[12px] md:text-[12px]" />
      </div>
      {directory.error ? (
        <p className="text-[12px] text-[var(--status-danger)]">{t("Couldn't search the registry: {error}", { error: directory.error.message })}</p>
      ) : directory.loading ? (
        <p className="text-[12px] text-muted-foreground">{t('Searching…')}</p>
      ) : directory.data.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{t('No servers match.')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {directory.data.map((e) => {
            const added = connectedEndpoints.has(e.endpoint);
            return (
              <div key={e.id} className={`${CARD} flex gap-3 p-3`}>
                <IntegrationIcon name={e.title} icon={null} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-foreground">{e.title}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{e.id}</div>
                  <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{e.description}</p>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{e.auth === 'none' ? t('No key, or sign-in on the server') : t('Needs a key')}</span>
                    {added
                      ? <span className="ml-auto text-[var(--status-success)]">{t('Added')}</span>
                      : <Button size="xs" variant="secondary" className="ml-auto" disabled={!canAdd} onClick={() => onAdd(e)}>{t('Add')}</Button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

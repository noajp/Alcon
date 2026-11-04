'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Integration, Json } from '@/types/database';
import { useIntegrationActions } from './data';

// What agents may do with an MCP connection, command by command. The
// commands come from the server's own tool list (the connection test writes
// them into the integration's manifest); a person only chooses, per command,
// whether agents may use it freely, must ask first, or may not use it at all.
// The engine enforces exactly this (run-agent, _shared/connectorManifest.ts).

type Permission = 'allow' | 'ask' | 'deny';
interface Command { name: string; effect: 'read' | 'write'; permission: Permission | null; description: string }

const LABEL: Record<Permission, string> = { allow: 'Allowed', ask: 'Asks first', deny: 'Not allowed' };

function readCommands(manifest: Json | null): { commands: Command[]; defaults: Record<string, Permission> } {
  const m = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest as Record<string, unknown> : {};
  const d = m.defaults && typeof m.defaults === 'object' ? m.defaults as Record<string, unknown> : {};
  const perm = (v: unknown): Permission | null => (v === 'allow' || v === 'ask' || v === 'deny' ? v : null);
  const defaults = { read: perm(d.read) ?? 'allow', write: perm(d.write) ?? 'ask' };
  const commands = (Array.isArray(m.commands) ? m.commands : []).flatMap((c): Command[] => {
    const x = c && typeof c === 'object' ? c as Record<string, unknown> : null;
    if (!x || typeof x.name !== 'string') return [];
    return [{ name: x.name, effect: x.effect === 'read' ? 'read' : 'write', permission: perm(x.permission), description: typeof x.description === 'string' ? x.description : '' }];
  });
  return { commands, defaults };
}

export function CommandPermissions({ integration, spaceId, readOnly }: { integration: Integration; spaceId: string; readOnly: boolean }) {
  const { t } = useI18n();
  const actions = useIntegrationActions(spaceId);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { commands, defaults } = readCommands(integration.manifest);
  if (commands.length === 0) {
    return <p className="text-[12px] text-muted-foreground">{t('Run the connection test to list what agents can do here.')}</p>;
  }

  const set = (name: string, permission: Permission) => {
    setError(null);
    const m = integration.manifest as Record<string, unknown>;
    const next = {
      ...m,
      commands: (m.commands as Record<string, unknown>[]).map((c) => (c.name === name ? { ...c, permission } : c)),
    } as Json;
    actions.update.mutate({ id: integration.id, patch: { manifest: next } }, { onError: (e) => setError(e instanceof Error ? e.message : String(e)) });
  };

  const sorted = [...commands].sort((a, b) => (a.effect === b.effect ? a.name.localeCompare(b.name) : a.effect === 'write' ? -1 : 1));
  const shown = showAll ? sorted : sorted.slice(0, 12);
  const writes = commands.filter((c) => c.effect === 'write').length;
  return (
    <div className="w-full min-w-0 space-y-2 overflow-hidden">
      <p className="text-[12px] text-muted-foreground">
        {t('{reads} read and {writes} write commands. Reads are allowed and writes ask first unless you change them.', { reads: commands.length - writes, writes })}
      </p>
      {integration.delegation === 'full_delegation' && (
        <p className="text-[12px] text-[var(--status-warning)]">{t('Full delegation is on, so commands set to “Asks first” run without asking. “Not allowed” still holds.')}</p>
      )}
      <ul className="min-w-0 divide-y divide-[var(--border-default)]">
        {shown.map((c) => {
          const effective = c.permission ?? defaults[c.effect];
          return (
            <li key={c.name} className="flex min-w-0 items-center gap-2 py-1.5 text-[12px]">
              <span className="min-w-0 flex-1 overflow-hidden">
                <span className="font-mono text-foreground">{c.name}</span>
                <span className="ml-2 text-muted-foreground">{c.effect === 'read' ? t('read') : t('write')}</span>
                {c.description && <span className="line-clamp-1 text-[11px] text-muted-foreground">{c.description}</span>}
              </span>
              <select value={effective} disabled={readOnly || actions.update.isPending} onChange={(e) => set(c.name, e.target.value as Permission)}
                aria-label={t('Permission for {name}', { name: c.name })}
                className={cn('rounded border border-border/60 bg-transparent px-1 py-0.5 text-[12px]', effective === 'deny' ? 'text-[var(--status-danger)]' : 'text-foreground')}>
                {(['allow', 'ask', 'deny'] as const).map((p) => <option key={p} value={p}>{t(LABEL[p])}</option>)}
              </select>
            </li>
          );
        })}
      </ul>
      {sorted.length > 12 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[12px] text-muted-foreground hover:text-foreground">
          {showAll ? t('Show fewer') : t('Show all {count}', { count: sorted.length })}
        </button>
      )}
      {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}
    </div>
  );
}

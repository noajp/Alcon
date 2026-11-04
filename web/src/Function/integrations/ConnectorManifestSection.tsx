'use client';

import { useState } from 'react';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Integration, Json } from '@/types/database';
import { useIntegrationActions } from './data';

// What an integration may be asked to do, and how to use it. The manifest is
// the policy run-agent enforces: with one, an agent sees only the commands it
// declares, each read or write and allowed / asked for / denied. The guide is
// read by the agent and enforces nothing. The preview here only reads the
// shape; run-agent checks the rest and logs what it could not read.

type Permission = 'allow' | 'ask' | 'deny';
interface PreviewCommand { name: string; action: string; effect: 'read' | 'write' | '?'; permission: Permission }

const PERMISSION_LABEL: Record<Permission, string> = { allow: 'Allowed', ask: 'Asks first', deny: 'Denied' };

function preview(text: string): { commands: PreviewCommand[] } | { error: string } | null {
  if (!text.trim()) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { error: 'This is not valid JSON.' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The manifest must be a JSON object.' };
  const m = raw as { commands?: unknown; defaults?: Record<string, unknown> };
  const defaults = m.defaults && typeof m.defaults === 'object' ? m.defaults : {};
  const commands = (Array.isArray(m.commands) ? m.commands : []).map((c): PreviewCommand => {
    const x = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    const effect = x.effect === 'read' || x.effect === 'write' ? x.effect : '?';
    const given = x.permission ?? (effect === '?' ? undefined : defaults[effect]);
    const permission: Permission = given === 'allow' || given === 'ask' || given === 'deny' ? given : effect === 'read' ? 'allow' : 'ask';
    const name = typeof x.name === 'string' ? x.name : '?';
    return { name, action: typeof x.action === 'string' && x.action ? x.action : name, effect, permission };
  });
  return { commands };
}

const textOf = (manifest: Json | null) => (manifest == null ? '' : JSON.stringify(manifest, null, 2));

export function ConnectorManifestSection({ integration, readOnly }: { integration: Integration; readOnly: boolean }) {
  const { t } = useI18n();
  const actions = useIntegrationActions(integration.activity_space_id);
  const [manifest, setManifest] = useState(() => textOf(integration.manifest));
  const [guide, setGuide] = useState(integration.guide ?? '');
  const [error, setError] = useState<string | null>(null);
  const parsed = preview(manifest);
  const dirty = manifest !== textOf(integration.manifest) || guide !== (integration.guide ?? '');

  const save = () => {
    setError(null);
    if (parsed && 'error' in parsed) { setError(t(parsed.error)); return; }
    const next = manifest.trim() ? JSON.parse(manifest) as Json : null;
    actions.update.mutate(
      { id: integration.id, patch: { manifest: next, guide: guide.trim() || null } },
      { onError: (e) => setError(e instanceof Error ? e.message : String(e)) },
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground">
        {t('Declare the commands agents may use. With a manifest, agents see only these commands, and each one is allowed, asked for or denied.')}
      </p>
      <Textarea value={manifest} onChange={(e) => setManifest(e.target.value)} disabled={readOnly} rows={8} spellCheck={false}
        placeholder={'{ "commands": [ { "name": "search_issues", "action": "issues.search", "effect": "read", "http": { "method": "GET", "path": "/search/issues", "query": ["q"] } } ] }'}
        className="font-mono text-[12px]" />
      {parsed && 'error' in parsed && <p className="text-[12px] text-[var(--status-danger)]">{t(parsed.error)}</p>}
      {parsed && 'commands' in parsed && (
        parsed.commands.length === 0
          ? <p className="text-[12px] text-[var(--status-danger)]">{t('No commands are declared, so agents cannot use this connection.')}</p>
          : (
            <ul className="space-y-1">
              {parsed.commands.map((c, i) => (
                <li key={`${c.name}-${i}`} className="flex items-center gap-2 text-[12px]">
                  <span className="font-mono text-foreground">{c.name}</span>
                  {c.action !== c.name && <span className="font-mono text-muted-foreground">{c.action}</span>}
                  <span className="text-muted-foreground">{c.effect === '?' ? '?' : t(c.effect)}</span>
                  <span className={cn('ml-auto', c.permission === 'deny' ? 'text-[var(--status-danger)]' : 'text-muted-foreground')}>{t(PERMISSION_LABEL[c.permission])}</span>
                </li>
              ))}
            </ul>
          )
      )}
      <Textarea value={guide} onChange={(e) => setGuide(e.target.value)} disabled={readOnly} rows={4}
        placeholder={t('How to use this connection, for agents (not enforced)')} className="text-[12px]" />
      {error && <p className="text-[12px] text-[var(--status-danger)]">{error}</p>}
      {!readOnly && (
        <Button variant="secondary" size="sm" onClick={save} disabled={!dirty || actions.update.isPending}>{t('Save')}</Button>
      )}
    </div>
  );
}

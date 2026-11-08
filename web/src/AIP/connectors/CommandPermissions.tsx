'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Integration, Json } from '@/types/database';
import {
  criticalClassOfManifestCommand, effectiveOutcome, policyLineFor, CRITICAL_CLASS_LABELS, type EffectiveOutcome,
} from './catalog';
import { useSpaceApprovalMode } from './approvalModeData';
import type { ApprovalMode } from './approvalModeModel';
import { useIntegrationActions } from './data';

// What agents may do with an MCP connection, command by command. The
// commands come from the server's own tool list (the connection test writes
// them into the integration's manifest); a person only chooses, per command,
// whether agents may use it freely, must ask first, or may not use it at all.
// A command can also carry conditions on its arguments ("repo is Alcon →
// allowed", "to is *@example.com → allowed, otherwise not allowed"): the
// first that matches decides, under any delegation. Approving with "Don’t ask
// again" adds one. The engine enforces exactly this (run-agent,
// _shared/connectorManifest.ts).

type Permission = 'allow' | 'ask' | 'deny';
interface Rule { when: Record<string, string>; permission: Permission }
/** How a call reads on an approval card, as the manifest declares it.
 *  Read for forward compatibility (a presentation editor is a later
 *  surface); nothing here renders it yet — the engine resolves it into
 *  the approval display when a call is held. */
interface CommandPresent { title?: string; fields?: { arg: string; label: string }[]; preview?: string }
interface Command {
  name: string; action: string; effect: 'read' | 'write'; permission: Permission | null; description: string; rules: Rule[];
  mcp: string | null; http: { method: string; path: string } | null; present: CommandPresent | null;
}

const LABEL: Record<Permission, string> = { allow: 'Allowed', ask: 'Asks first', deny: 'Not allowed' };

/**
 * The plain-words chip a row gains when what will happen differs from
 * what its stored setting says alone — the lift or the collapse a
 * person otherwise could not see on the row itself. Null when the
 * select already tells the truth, when a critical chip already says
 * it, or when conditions decide per call (the conditions are listed
 * on the row; they are the statement).
 */
function outcomeChipText(outcome: EffectiveOutcome): string | null {
  if (outcome.kind === 'runs' && outcome.how === 'delegation') return 'Runs without asking — full delegation';
  if (outcome.kind === 'runs' && outcome.how === 'mode-free') return 'Runs without asking — recorded as a policy approval (Free action)';
  if (outcome.kind === 'asks' && outcome.why === 'mode') return 'Asks first — this Space asks every time';
  return null;
}

function readCommands(manifest: Json | null): { commands: Command[]; defaults: Record<string, Permission> } {
  const m = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest as Record<string, unknown> : {};
  const d = m.defaults && typeof m.defaults === 'object' ? m.defaults as Record<string, unknown> : {};
  const perm = (v: unknown): Permission | null => (v === 'allow' || v === 'ask' || v === 'deny' ? v : null);
  const defaults = { read: perm(d.read) ?? 'allow', write: perm(d.write) ?? 'ask' };
  const commands = (Array.isArray(m.commands) ? m.commands : []).flatMap((c): Command[] => {
    const x = c && typeof c === 'object' ? c as Record<string, unknown> : null;
    if (!x || typeof x.name !== 'string') return [];
    const rules = (Array.isArray(x.rules) ? x.rules : []).flatMap((r): Rule[] => {
      const y = r && typeof r === 'object' ? r as Record<string, unknown> : null;
      const when = y?.when && typeof y.when === 'object' && !Array.isArray(y.when) ? y.when as Record<string, unknown> : null;
      const p = perm(y?.permission);
      if (!when || !p || !Object.values(when).every((v) => typeof v === 'string') || !Object.keys(when).length) return [];
      return [{ when: when as Record<string, string>, permission: p }];
    });
    const h = x.http && typeof x.http === 'object' && !Array.isArray(x.http) ? x.http as Record<string, unknown> : null;
    const pv = x.present && typeof x.present === 'object' && !Array.isArray(x.present) ? x.present as Record<string, unknown> : null;
    const present: CommandPresent | null = pv ? {
      ...(typeof pv.title === 'string' ? { title: pv.title } : {}),
      ...(Array.isArray(pv.fields) ? {
        fields: pv.fields.flatMap((f): { arg: string; label: string }[] => {
          const y = f && typeof f === 'object' ? f as Record<string, unknown> : null;
          return y && typeof y.arg === 'string' && typeof y.label === 'string' ? [{ arg: y.arg, label: y.label }] : [];
        }),
      } : {}),
      ...(typeof pv.preview === 'string' ? { preview: pv.preview } : {}),
    } : null;
    return [{
      name: x.name, action: typeof x.action === 'string' && x.action ? x.action : x.name,
      effect: x.effect === 'read' ? 'read' : 'write', permission: perm(x.permission),
      description: typeof x.description === 'string' ? x.description : '', rules,
      mcp: typeof x.mcp === 'string' && x.mcp ? x.mcp : null,
      http: h && typeof h.method === 'string' && typeof h.path === 'string' ? { method: h.method, path: h.path } : null,
      present,
    }];
  });
  return { commands, defaults };
}

export function CommandPermissions({ integration, spaceId, readOnly }: { integration: Integration; spaceId: string; readOnly: boolean }) {
  const { t } = useI18n();
  const actions = useIntegrationActions(spaceId);
  // The Space's approval mode composes over every command's setting;
  // until it loads, the mirror reads "auto" — the mode that changes
  // nothing — so a chip is never shown on a guess.
  const spaceMode = useSpaceApprovalMode(spaceId);
  const mode: ApprovalMode = spaceMode.mode ?? 'auto';
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { commands, defaults } = readCommands(integration.manifest);
  if (commands.length === 0) {
    return <p className="text-[12px] text-muted-foreground">{t('Run the connection test to list what agents can do here.')}</p>;
  }

  const write = (name: string, patch: (c: Record<string, unknown>) => Record<string, unknown>) => {
    setError(null);
    const m = integration.manifest as Record<string, unknown>;
    const next = {
      ...m,
      commands: (m.commands as Record<string, unknown>[]).map((c) => (c.name === name ? patch(c) : c)),
    } as Json;
    actions.update.mutate({ id: integration.id, patch: { manifest: next } }, { onError: (e) => setError(e instanceof Error ? e.message : String(e)) });
  };
  const set = (name: string, permission: Permission) => write(name, (c) => ({ ...c, permission }));
  const setRules = (name: string, rules: Rule[]) => write(name, (c) => ({ ...c, rules }));

  // Commands with conditions first, then writes, then reads.
  const rank = (c: Command) => (c.rules.length ? 0 : c.effect === 'write' ? 1 : 2);
  const sorted = [...commands].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const shown = showAll ? sorted : sorted.slice(0, 12);
  const writes = commands.filter((c) => c.effect === 'write').length;
  const anyCritical = commands.some((c) => criticalClassOfManifestCommand(c) !== null);
  return (
    <div className="w-full min-w-0 space-y-2 overflow-hidden">
      <p className="text-[12px] text-muted-foreground">
        {t('{reads} read and {writes} write commands.', { reads: commands.length - writes, writes })}
      </p>
      {/* One policy line, computed from the delegation and the Space's
          mode by the same mirror the rows use — never a stack of
          warnings that can tell a different story than the rows. */}
      <p className="text-[12px] text-muted-foreground">{t(policyLineFor(integration.delegation, mode))}</p>
      {anyCritical && (
        <p className="text-[12px] text-muted-foreground">{t('Critical operations (send / money / delete / contract) always ask. Full delegation, “Allowed”, and conditions do not lift them, and they cannot be remembered.')}</p>
      )}
      <ul className="min-w-0 divide-y divide-[var(--border-default)]">
        {shown.map((c) => {
          const effective = c.permission ?? defaults[c.effect];
          const critical = criticalClassOfManifestCommand(c);
          // A critical row already carries its "Always asks" chip; the
          // outcome chip stays off it (under Free action the section's
          // policy line, not a second chip, says what the mode does).
          const chip = critical ? null : outcomeChipText(effectiveOutcome(
            { permission: effective, effect: c.effect, hasRules: c.rules.length > 0, critical },
            { delegation: integration.delegation, mode },
          ));
          return (
            <li key={c.name} className="min-w-0 py-1.5 text-[12px]">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 overflow-hidden">
                <span className="font-mono text-foreground">{c.name}</span>
                <span className="ml-2 text-muted-foreground">{c.effect === 'read' ? t('read') : t('write')}</span>
                {critical && (
                  <span className="ml-2 rounded-full border border-[var(--border-default)] px-1.5 text-[11px] text-[var(--status-warning)]">
                    {t('Always asks · {class}', { class: t(CRITICAL_CLASS_LABELS[critical]) })}
                  </span>
                )}
                {chip && (
                  <span className="ml-2 rounded-full border border-[var(--border-default)] px-1.5 text-[11px] text-[var(--status-warning)]">
                    {t(chip)}
                  </span>
                )}
                {c.description && <span className="line-clamp-1 text-[11px] text-muted-foreground">{c.description}</span>}
              </span>
              <select value={effective} disabled={readOnly || actions.update.isPending} onChange={(e) => set(c.name, e.target.value as Permission)}
                aria-label={t('Permission for {name}', { name: c.name })}
                className={cn('rounded border border-border/60 bg-transparent px-1 py-0.5 text-[12px]', effective === 'deny' ? 'text-[var(--status-danger)]' : 'text-foreground')}>
                {(['allow', 'ask', 'deny'] as const).map((p) => <option key={p} value={p}>{t(LABEL[p])}</option>)}
              </select>
            </div>
            <CommandRules rules={c.rules} disabled={readOnly || actions.update.isPending} onChange={(rules) => setRules(c.name, rules)} />
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

/** A command's conditions on its arguments: read, remove, or add one. */
function CommandRules({ rules, disabled, onChange }: { rules: Rule[]; disabled: boolean; onChange: (rules: Rule[]) => void }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [field, setField] = useState('');
  const [pattern, setPattern] = useState('');
  const [permission, setPermission] = useState<Permission>('allow');
  const fieldOk = /^[A-Za-z0-9_.-]{1,64}$/.test(field.trim());
  const add = () => {
    if (!fieldOk || !pattern.trim()) return;
    onChange([...rules, { when: { [field.trim()]: pattern.trim() }, permission }]);
    setField(''); setPattern(''); setPermission('allow'); setAdding(false);
  };
  return (
    <div className="mt-1 space-y-0.5 pl-3">
      {rules.map((r, i) => (
        <div key={i} className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {t('When')} <span className="font-mono text-foreground">{Object.entries(r.when).map(([k, v]) => `${k} = ${v}`).join(', ')}</span>
            {' → '}<span className={r.permission === 'deny' ? 'text-[var(--status-danger)]' : 'text-foreground'}>{t(LABEL[r.permission])}</span>
          </span>
          {!disabled && (
            <button type="button" onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label={t('Remove condition')}
              className="rounded px-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground">×</button>
          )}
        </div>
      ))}
      {!disabled && (adding ? (
        <form className="flex min-w-0 flex-wrap items-center gap-1 text-[11px]" onSubmit={(e) => { e.preventDefault(); add(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); } }}>
          <input autoFocus value={field} onChange={(e) => setField(e.target.value)} placeholder={t('argument (e.g. repo)')} aria-label={t('Argument')}
            className="w-28 rounded border border-border/60 bg-transparent px-1 py-0.5" />
          <span>=</span>
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={t('value (* matches anything)')} aria-label={t('Value')}
            className="w-40 rounded border border-border/60 bg-transparent px-1 py-0.5" />
          <span>→</span>
          <select value={permission} onChange={(e) => setPermission(e.target.value as Permission)} aria-label={t('Permission')}
            className="rounded border border-border/60 bg-transparent px-1 py-0.5">
            {(['allow', 'ask', 'deny'] as const).map((p) => <option key={p} value={p}>{t(LABEL[p])}</option>)}
          </select>
          <button type="submit" disabled={!fieldOk || !pattern.trim()} className="rounded px-1.5 py-0.5 text-foreground hover:bg-muted/50 disabled:opacity-50">{t('Add')}</button>
          <button type="button" onClick={() => setAdding(false)} className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted/50">{t('Cancel')}</button>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="text-[11px] text-muted-foreground hover:text-foreground">+ {t('Condition')}</button>
      ))}
    </div>
  );
}

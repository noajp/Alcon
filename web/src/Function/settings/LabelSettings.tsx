'use client';

import { useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Plus, Tag } from '@/ui/icons';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { MenuShell } from '@/Function/shared/menu';
import { LabelPaletteRows } from '@/Function/shared/LabelPaletteRows';
import { LABEL_PALETTE, labelColor, useLabelColors } from '@/Function/shared/labelColor';
import { CONTROL } from '@/shared/designTokens';
import { SettingsIsland } from './SettingsControls';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useLabelCatalog, type DomainLabelState } from './useLabelCatalog';
import {
  buildLabelCatalog,
  formatElementCount,
  formatLabelCount,
  newLabelProblem,
  normalizeLabelName,
  type LabelEntry,
} from './labelCatalog';

// Settings › Elements › Labels. One section per Domain of the current Space,
// because that is the unit a label's colour lives in: `domains.label_colors`.
// The list is the union of what Elements carry and what the colour map knows,
// so a label created here ahead of use shows as "Unused" until the first
// Element picks it up — and an Element's free-text label with no colour shows
// up too, ready to be given one.

const DEFAULT_NEW_LABEL_COLOR = 'grey';

type PendingAction =
  | { kind: 'rename'; domain: DomainLabelState; from: string; to: string; count: number; merges: boolean }
  | { kind: 'delete'; domain: DomainLabelState; name: string; count: number };

export function LabelSettings() {
  const { t } = useI18n();
  const { domains, loading, error, busyDomains, setColor, rename, remove } = useLabelCatalog();
  const [pending, setPending] = useState<PendingAction | null>(null);
  useLabelColors();

  const confirmPending = () => {
    if (!pending) return;
    if (pending.kind === 'rename') void rename(pending.domain.id, pending.from, pending.to);
    else void remove(pending.domain.id, pending.name);
    setPending(null);
  };

  return (
    <div className="space-y-6">
      <p className="-mt-2 text-[12px] text-muted-foreground">
        {t('Labels are free text on Elements; each Domain remembers a colour per name. Renaming or deleting one here rewrites every Element in that Domain — an Element homed in two Domains changes in both.')}
      </p>

      {error && (
        <div className="text-[12px] text-destructive">{error}</div>
      )}

      {loading && domains.length === 0 ? (
        <div className="text-[13px] text-muted-foreground">{t('Loading…')}</div>
      ) : domains.length === 0 ? (
        <div className="text-[13px] text-muted-foreground">{t('No Domains in this Space yet.')}</div>
      ) : (
        domains.map((domain) => (
          <DomainLabels
            key={domain.id}
            domain={domain}
            busy={busyDomains.has(domain.id)}
            onColor={(name, colorKey) => void setColor(domain.id, name, colorKey)}
            onRename={(from, to, entries) =>
              setPending({
                kind: 'rename',
                domain,
                from,
                to,
                count: entries.find((e) => e.name === from)?.count ?? 0,
                merges: entries.some((e) => e.name === to),
              })
            }
            onDelete={(name, entries) =>
              setPending({ kind: 'delete', domain, name, count: entries.find((e) => e.name === name)?.count ?? 0 })
            }
          />
        ))
      )}

      {pending && (
        <ConfirmLabelDialog action={pending} onDismiss={() => setPending(null)} onConfirm={confirmPending} />
      )}
    </div>
  );
}

function DomainLabels({
  domain,
  busy,
  onColor,
  onRename,
  onDelete,
}: {
  domain: DomainLabelState;
  busy: boolean;
  onColor: (name: string, colorKey: string) => void;
  onRename: (from: string, to: string, entries: LabelEntry[]) => void;
  onDelete: (name: string, entries: LabelEntry[]) => void;
}) {
  const { t } = useI18n();
  const entries = useMemo(() => buildLabelCatalog(domain.rows, domain.colors), [domain.rows, domain.colors]);
  const [creating, setCreating] = useState(false);

  const unused = entries.filter((e) => e.count === 0).length;
  const description = !domain.loaded
    ? t('Counting…')
    : entries.length === 0
      ? t('No labels yet')
      : entries.length === 1
        ? t('1 label · {unused} unused', { unused })
        : t('{n} labels · {unused} unused', { n: entries.length, unused });

  return (
    <SettingsIsland title={domain.name} description={description}>
      <div className="px-5 py-2">
        {entries.map((entry) => (
          <LabelRow
            key={entry.name}
            domain={domain}
            entry={entry}
            busy={busy}
            onColor={(colorKey) => onColor(entry.name, colorKey)}
            onRename={(to) => onRename(entry.name, to, entries)}
            onDelete={() => onDelete(entry.name, entries)}
          />
        ))}
        {creating ? (
          <NewLabelRow
            entries={entries}
            onCreate={(name, colorKey) => {
              onColor(name, colorKey);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <div className="flex h-10 items-center">
            <ButtonAppearanceProvider appearance="inline">
              <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
                <Plus size={CONTROL.icon.sm} />
                {t('New label')}
              </Button>
            </ButtonAppearanceProvider>
          </div>
        )}
      </div>
    </SettingsIsland>
  );
}

function LabelRow({
  domain,
  entry,
  busy,
  onColor,
  onRename,
  onDelete,
}: {
  domain: DomainLabelState;
  entry: LabelEntry;
  busy: boolean;
  onColor: (colorKey: string) => void;
  onRename: (to: string) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.name);
  // Radix hands focus back to the "…" trigger when the menu closes, which
  // would blur the rename field the instant it mounts. Skipped for that one
  // close only.
  const keepFocusOffTriggerRef = useRef(false);

  const submit = () => {
    const to = normalizeLabelName(draft);
    setEditing(false);
    if (to && to !== entry.name) onRename(to);
  };

  const cancel = () => {
    setDraft(entry.name);
    setEditing(false);
  };

  return (
    <div className="-mx-2 flex h-10 items-center gap-2 rounded-md px-2 transition-colors hover:bg-muted/40">
      <ColorSwatch
        label={entry.name}
        hex={labelColor(entry.name, domain.id)}
        colorKey={entry.colorKey}
        onPick={onColor}
      />
      {editing ? (
        <input
          autoFocus
          value={draft}
          aria-label={t('New name for {name}', { name: entry.name })}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={cancel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-2 text-[13px] text-foreground transition-[background-color] focus:bg-[var(--surface-strong)]"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate px-2 text-[13px] text-foreground">{entry.name}</span>
      )}
      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
        {domain.loaded ? formatLabelCount(entry.count) : '…'}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('Actions for {name}', { name: entry.name })}
            disabled={busy || !domain.loaded}
          >
            <MoreHorizontal size={CONTROL.icon.xs} />
          </Button>
        </DropdownMenuTrigger>
        <MenuShell
          as="dropdown"
          align="end"
          onCloseAutoFocus={(e) => {
            if (keepFocusOffTriggerRef.current) {
              e.preventDefault();
              keepFocusOffTriggerRef.current = false;
            }
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              keepFocusOffTriggerRef.current = true;
              setDraft(entry.name);
              setEditing(true);
            }}
          >
            {t('Rename')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onDelete}
            className="text-[var(--status-danger)] focus:text-[var(--status-danger)]"
          >
            {t('Delete')}
          </DropdownMenuItem>
        </MenuShell>
      </DropdownMenu>
    </div>
  );
}

function NewLabelRow({
  entries,
  onCreate,
  onCancel,
}: {
  entries: LabelEntry[];
  onCreate: (name: string, colorKey: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [colorKey, setColorKey] = useState(DEFAULT_NEW_LABEL_COLOR);
  const trimmed = normalizeLabelName(name);
  const problem = newLabelProblem(trimmed, entries);

  const submit = () => {
    if (problem) return;
    onCreate(trimmed, colorKey);
  };

  return (
    <div className="flex h-10 items-center gap-2">
      <ColorSwatch
        label={trimmed || t('the new label')}
        hex={LABEL_PALETTE.find((p) => p.key === colorKey)?.hex ?? labelColor(trimmed)}
        colorKey={colorKey}
        onPick={setColorKey}
      />
      <input
        autoFocus
        value={name}
        placeholder={t('Label name…')}
        aria-label={t('New label name')}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            // First Escape clears a draft, the second closes — typed text
            // never vanishes on a single key.
            if (name) setName('');
            else onCancel();
          }
        }}
        className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-2 text-[13px] text-foreground transition-[background-color] placeholder:text-muted-foreground focus:bg-[var(--surface-strong)]"
      />
      {trimmed && problem && (
        <span className="shrink-0 text-[12px] text-[var(--status-danger)]">{problem}</span>
      )}
      <Button variant="ghost" size="sm" onClick={onCancel}>
        {t('Cancel')}
      </Button>
      <Button variant="secondary" size="sm" onClick={submit} disabled={problem !== null}>
        {t('Create')}
      </Button>
    </div>
  );
}

function ColorSwatch({
  label,
  hex,
  colorKey,
  onPick,
}: {
  label: string;
  hex: string;
  colorKey: string | null;
  onPick: (colorKey: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('Colour of {name}', { name: label })}>
          <Tag aria-hidden size={12} className="shrink-0" style={{ color: hex }} />
        </Button>
      </PopoverTrigger>
      <MenuShell align="start">
        <LabelPaletteRows
          selected={colorKey}
          onPick={(key) => {
            onPick(key);
            setOpen(false);
          }}
        />
      </MenuShell>
    </Popover>
  );
}

function ConfirmLabelDialog({
  action,
  onDismiss,
  onConfirm,
}: {
  action: PendingAction;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const domain = action.domain.name;
  const n = action.count;
  const count = formatElementCount(n);

  const title = action.kind === 'rename' ? t('Rename “{name}”', { name: action.from }) : t('Delete “{name}”', { name: action.name });
  const body =
    action.kind === 'rename'
      ? [
          n === 0
            ? t('No Element in {domain} carries “{from}”; only its colour entry is renamed to “{to}”.', { domain, from: action.from, to: action.to })
            : t('“{from}” becomes “{to}” on {count} in {domain}.', { from: action.from, to: action.to, count, domain }),
          action.merges
            ? t('“{name}” already exists there — the two merge, and an Element carrying both keeps one.', { name: action.to })
            : null,
        ]
          .filter(Boolean)
          .join(' ')
      : n === 0
        ? t('No Element in {domain} carries “{name}”; its colour entry is dropped.', { domain, name: action.name })
        : t('Removes it from {count} in {domain} and drops its colour. This cannot be undone.', { count, domain });
  const confirmLabel =
    action.kind === 'rename'
      ? n === 0 ? t('Rename') : t('Rename {count}', { count })
      : n === 0 ? t('Delete') : t('Delete from {count}', { count });

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onDismiss(); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={onDismiss}>
            {t('Cancel')}
          </Button>
          <Button
            variant={action.kind === 'rename' ? 'primary' : 'danger'}
            size="md"
            onClick={onConfirm}
            autoFocus={action.kind === 'rename'}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

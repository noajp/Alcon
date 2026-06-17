'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Box as BoxIcon,
  CalendarIcon,
  Check,
  ChevronDown,
  Sparkles,
  Tag as TagIcon,
  User as UserIcon,
  X,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/ui/dropdown-menu';

// Submit payload — one Object per popup, with rich fields collected from the
// pill row. Caller persists via createObject + an immediate updateObject for
// type / lead_id / due_date (createObject accepts name / description /
// domain_id only).
export interface NewObjectInput {
  name: string;
  description?: string | null;
  type?: string | null;
  leadWorkerId?: string | null;
  dueDate?: string | null;       // 'YYYY-MM-DD'
  domainId?: string | null;
}

interface QuickAddObjectPopupProps {
  open: boolean;
  contextLabel?: string;
  hint?: string;
  onClose: () => void;
  onSubmit: (input: NewObjectInput) => void | Promise<void>;
  /** Workers for the Lead pill picker. */
  workers?: { id: string; name: string }[];
  /** Available Domains for the Domain pill (hidden when ≤1). */
  domains?: { id: string; name: string }[];
  /** Object-type catalog (domain.object_types) for the Type pill. */
  types?: string[];
  /** Pre-selected Domain (typically the active one). */
  defaultDomainId?: string | null;
}

/**
 * Object equivalent of QuickAddElementPopup. Single-Object popup (no
 * multi-paste — an Object's identity matters too much for batch creation).
 * Linear-style: rounded card lifted on a thin border at the bottom of the
 * viewport, no dimmer behind.
 */
export function QuickAddObjectPopup({
  open,
  contextLabel,
  hint = 'Create an Object to group Elements (and stay queryable across Domains).',
  onClose,
  onSubmit,
  workers = [],
  domains = [],
  types = [],
  defaultDomainId = null,
}: QuickAddObjectPopupProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [domainId, setDomainId] = useState<string | null>(defaultDomainId);
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setType(null);
    setLeadId(null);
    setDueDate(null);
    setDomainId(defaultDomainId);
    const t = setTimeout(() => taRef.current?.focus(), 10);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open, onClose, defaultDomainId]);

  useEffect(() => {
    const ta = taRef.current; if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [name]);
  useEffect(() => {
    const ta = descRef.current; if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [description]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !busy;

  if (!open) return null;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onSubmit({
        name: trimmedName,
        description: description.trim() || null,
        type,
        leadWorkerId: leadId,
        dueDate,
        domainId,
      });
      onClose();
    } catch (e) {
      console.error('QuickAddObject submit failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const leadWorker = leadId ? workers.find((w) => w.id === leadId) ?? null : null;
  const domainPick = domainId ? domains.find((d) => d.id === domainId) ?? null : null;

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none">
      <div
        className="pointer-events-auto w-full max-w-[640px] rounded-2xl bg-popover/95 backdrop-blur-md border border-border/60 p-3"
        role="dialog"
        aria-label="Quick add Object"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-1 mb-2">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted/40 text-[12px] text-muted-foreground">
            <BoxIcon size={12} />
            <span className="truncate max-w-[200px]">{contextLabel ?? 'New Object'}</span>
          </span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Name */}
        <textarea
          ref={taRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Object name… (Enter to create)"
          rows={1}
          className="w-full bg-transparent px-2 py-1 text-[15px] font-medium text-foreground placeholder:text-muted-foreground/60 resize-none"
        />

        {/* Description */}
        <textarea
          ref={descRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add description…"
          rows={1}
          className="w-full bg-transparent px-2 py-1 text-[13px] text-foreground/85 placeholder:text-muted-foreground/50 resize-none"
        />

        {/* Pill row — Type / Lead / Due date / Domain */}
        <div className="flex flex-wrap items-center gap-1.5 px-1 pt-2">
          {/* Type — only when the Domain has a type catalog */}
          {types.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={pillClass(!!type)}>
                  <TagIcon size={12} className="text-muted-foreground" />
                  <span>{type ?? 'Type'}</span>
                  <ChevronDown size={10} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[180px]">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Type</DropdownMenuLabel>
                {types.map((t) => (
                  <DropdownMenuItem key={t} onSelect={() => setType(t)} className="gap-2 text-[12px]">
                    <TagIcon size={12} className="text-muted-foreground" />
                    <span className="flex-1 truncate">{t}</span>
                    {type === t && <Check size={12} />}
                  </DropdownMenuItem>
                ))}
                {type && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setType(null)} className="text-[12px] text-muted-foreground">Clear</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Lead — single-select Worker */}
          {workers.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={pillClass(!!leadWorker)}>
                  <UserIcon size={12} className="text-muted-foreground" />
                  <span>{leadWorker?.name ?? 'Lead'}</span>
                  <ChevronDown size={10} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[220px] max-h-[260px] overflow-y-auto">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Lead</DropdownMenuLabel>
                {workers.map((w) => (
                  <DropdownMenuItem key={w.id} onSelect={() => setLeadId(w.id)} className="gap-2 text-[12px]">
                    <UserIcon size={12} className="text-muted-foreground" />
                    <span className="flex-1 truncate">{w.name}</span>
                    {leadId === w.id && <Check size={12} />}
                  </DropdownMenuItem>
                ))}
                {leadWorker && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setLeadId(null)} className="text-[12px] text-muted-foreground">Clear</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Due date — native input, kept inside the pill chip via labelled
              span so it looks like the other pills. */}
          <label className={pillClass(!!dueDate) + ' cursor-pointer'}>
            <CalendarIcon size={12} className="text-muted-foreground" />
            <span>{dueDate ?? 'Due date'}</span>
            <input
              type="date"
              value={dueDate ?? ''}
              onChange={(e) => setDueDate(e.target.value || null)}
              className="sr-only"
            />
            {dueDate ? (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); setDueDate(null); }}
                className="ml-0.5 text-muted-foreground/70 hover:text-foreground"
                aria-label="Clear due date"
              >
                <X size={11} />
              </button>
            ) : (
              <ChevronDown size={10} className="opacity-60" />
            )}
          </label>

          {/* Domain — shown whenever any Domain is available so the user can
              re-target away from the default (was hidden when only one
              Domain existed, which made the destination feel hard-coded). */}
          {domains.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={pillClass(!!domainPick)}>
                  <BoxIcon size={12} className="text-muted-foreground" />
                  <span>{domainPick?.name ?? 'Domain'}</span>
                  <ChevronDown size={10} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[220px] max-h-[260px] overflow-y-auto">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Domain</DropdownMenuLabel>
                {domains.map((d) => (
                  <DropdownMenuItem key={d.id} onSelect={() => setDomainId(d.id)} className="gap-2 text-[12px]">
                    <BoxIcon size={12} className="text-muted-foreground" />
                    <span className="flex-1 truncate">{d.name}</span>
                    {domainId === d.id && <Check size={12} />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-1 pt-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80 min-w-0 truncate">
            <Sparkles size={11} />
            <span className="truncate">{hint}</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowUp size={13} />
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function pillClass(active: boolean): string {
  return [
    'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] transition-colors border',
    active
      ? 'bg-muted/50 border-border/60 text-foreground hover:bg-muted/70'
      : 'bg-transparent border-border/40 text-muted-foreground hover:bg-muted/30 hover:text-foreground',
  ].join(' ');
}

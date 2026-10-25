'use client';

import { QUICK_CREATE } from '@/shared/designTokens';
import { quickCreatePillClass as pillClass } from '@/Function/shared/QuickCreatePopup';
import { Button } from '@/ui/button';

import { useEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import {
  CalendarIcon,
  Check,
  ChevronDown,
  User as UserIcon,
  X,
} from 'lucide-react';
import { ObjectIcon as BoxIcon, DomainIcon } from '@/Function/shared/conceptIcons';
import { DatePopover } from '@/Function/shared/date';
import { useI18n } from '@/Function/i18n/I18nProvider';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/ui/dropdown-menu';

// One Object, including its initial fields and Domain memberships.
export interface NewObjectInput {
  name: string;
  description?: string | null;
  type?: string | null;
  leadWorkerId?: string | null;
  dueDate?: string | null;       // 'YYYY-MM-DD'
  domainId?: string | null;
  domainIds?: string[];
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
  hint,
  onClose,
  onSubmit,
  workers = [],
  domains = [],
  types = [],
  defaultDomainId = null,
}: QuickAddObjectPopupProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [domainIds, setDomainIds] = useState<string[]>(defaultDomainId ? [defaultDomainId] : []);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Exclusive menu open state — opening one pill closes the others (matches
  // QuickAddElementPopup; Radix doesn't close adjacent dropdowns by default
  // when they're nested in the same popup container).
  type MenuId = 'type' | 'lead' | 'domain';
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const menuProps = (id: MenuId) => ({
    open: openMenu === id,
    onOpenChange: (next: boolean) => setOpenMenu(next ? id : null),
  });
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setType(null);
    setLeadId(null);
    setDueDate(null);
    setDomainIds(defaultDomainId ? [defaultDomainId] : []);
    setError(null);
    const t = setTimeout(() => taRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open, defaultDomainId]);

  // Close on Esc — as a layer, so a picker opened from inside the popup takes
  // the key first and the popup gets the next one.
  useEscapeLayer(open, onClose);

  useEffect(() => {
    const ta = taRef.current; if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [name]);
  useEffect(() => {
    const ta = descRef.current; if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight, QUICK_CREATE.descriptionMinHeight), 240)}px`;
  }, [description]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !busy;

  if (!open) return null;

  const handleSubmit = async () => {
    if (!canSubmit || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: trimmedName,
        description: description.trim() || null,
        type,
        leadWorkerId: leadId,
        dueDate,
        domainId,
        domainIds: domainId ? [domainId, ...domainIds.filter(id => id !== domainId)] : [],
      });
      onClose();
    } catch (e) {
      console.error('QuickAddObject submit failed:', e);
      setError(e instanceof Error ? e.message : t('Failed to create Object. Please try again.'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const domainId = defaultDomainId && domainIds.includes(defaultDomainId) ? defaultDomainId : domainIds[0] ?? null;
  const leadWorker = leadId ? workers.find((w) => w.id === leadId) ?? null : null;
  const domainPick = domainId ? domains.find((d) => d.id === domainId) ?? null : null;

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none">
      <div
        className={QUICK_CREATE.panel}
        role="dialog"
        aria-label={t('Quick add Object')}
      >
        {/* Header */}
        <div className={QUICK_CREATE.header}>
          <span className={QUICK_CREATE.context}>
            <BoxIcon size={12} />
            <span className="truncate max-w-[200px]">{contextLabel ?? 'New Object'}</span>
          </span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label={t('Close')}
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
          placeholder={t('Object name…')}
          aria-label={t('Object name')}
          rows={1}
          className={QUICK_CREATE.title}
        />

        {/* Description — compact at rest, grows with the content. */}
        <textarea
          ref={descRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('Add description…')}
          aria-label={t('Description')}
          rows={2}
          className={QUICK_CREATE.description}
        />

        {/* Pill row — Type / Lead / Due date / Domain */}
        <div className={QUICK_CREATE.properties}>
          {/* Type — only when the Domain has a type catalog.
              Iconless on purpose: Type is structural, not a label/tag, so the
              previous lucide Tag icon misread as "this is a Label". */}
          {types.length > 0 && (
            <DropdownMenu {...menuProps('type')}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={pillClass(!!type)}>
                  <span>{type ?? t('Type')}</span>
                  <ChevronDown size={10} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[180px]">
                <DropdownMenuLabel className="text-[10px] text-muted-foreground/70">{t('Type')}</DropdownMenuLabel>
                {types.map((t) => (
                  <DropdownMenuItem key={t} onSelect={() => setType(t)} className="gap-2 text-[12px]">
                    <span className="flex-1 truncate">{t}</span>
                    {type === t && <Check size={12} />}
                  </DropdownMenuItem>
                ))}
                {type && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setType(null)} className="text-[12px] text-muted-foreground">{t('Clear')}</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Lead — single-select Worker */}
          {workers.length > 0 && (
            <DropdownMenu {...menuProps('lead')}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={pillClass(!!leadWorker)}>
                  <UserIcon size={12} className="text-muted-foreground" />
                  <span>{leadWorker?.name ?? t('Object lead')}</span>
                  <ChevronDown size={10} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[220px] max-h-[260px] overflow-y-auto">
                <DropdownMenuLabel className="text-[10px] text-muted-foreground/70">{t('Object lead')}</DropdownMenuLabel>
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
                    <DropdownMenuItem onSelect={() => setLeadId(null)} className="text-[12px] text-muted-foreground">{t('Clear')}</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Due date — the app's calendar behind the same pill chip the Type
              and Lead pills use, so all three open the same kind of surface. */}
          <DatePopover value={dueDate} onChange={setDueDate}>
            <button type="button" className={pillClass(!!dueDate)} aria-label={t('Due date')}>
              <CalendarIcon size={12} className="text-muted-foreground" />
              <span>{dueDate ?? t('Due date')}</span>
              <ChevronDown size={10} className="opacity-60" />
            </button>
          </DatePopover>

          {/* Domain — shown whenever any Domain is available so the user can
              re-target away from the default (was hidden when only one
              Domain existed, which made the destination feel hard-coded). */}
          {domains.length > 0 && (
            <DropdownMenu {...menuProps('domain')}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={pillClass(!!domainPick)}>
                  <DomainIcon size={12} className="text-muted-foreground" />
                  <span>{domainPick?.name ?? t('Domain')}{domainIds.length > 1 ? ` +${domainIds.length - 1}` : ''}</span>
                  <ChevronDown size={10} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[220px] max-h-[260px] overflow-y-auto">
                <DropdownMenuLabel className="text-[10px] text-muted-foreground/70">{t('Domain')}</DropdownMenuLabel>
                {domains.map((d) => (
                  <DropdownMenuCheckboxItem
                    key={d.id}
                    checked={domainIds.includes(d.id)}
                    onSelect={event => event.preventDefault()}
                    onCheckedChange={() => setDomainIds(ids => ids.includes(d.id)
                      ? (ids.length > 1 ? ids.filter(id => id !== d.id) : ids)
                      : [...ids, d.id])}
                    className="gap-2 text-[12px]"
                  >
                    <DomainIcon size={12} className="text-muted-foreground" />
                    <span className="flex-1 truncate">{d.name}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {error && <p role="alert" className="pt-2 text-xs text-destructive">{error}</p>}

        <div className={QUICK_CREATE.footer}>
          {hint && <span className="mr-auto min-w-0 text-[11px] text-muted-foreground">{hint}</span>}
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
            {t('Create')}
          </Button>
        </div>
      </div>
    </div>
  );
}


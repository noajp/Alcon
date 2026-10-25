'use client';

import { QUICK_CREATE } from '@/shared/designTokens';
import { quickCreatePillClass as pillClass } from '@/Function/shared/QuickCreatePopup';
import { Button } from '@/ui/button';

import { STATUS_OPTIONS, PRIORITY_OPTIONS } from '@/shared/designTokens';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import {
  Check,
  ChevronDown,
  LayoutTemplate,
  Tag as TagIcon,
  User as UserIcon,
  X,
} from 'lucide-react';
import { ElementIcon, ObjectIcon as BoxIcon } from '@/Function/shared/conceptIcons';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { PriorityMark } from '@/Function/shared/PriorityMark';
import { PriorityPicker } from '@/Function/shared/PriorityPicker';
import { labelColor, useLabelColors } from '@/Function/shared/labelColor';
import { ReachHint, WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { workerTriggerLabel } from '@/Function/shared/workerReach';
import { NavMyTasksIcon } from '@/shell/sidebar/NavIcons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { ElementPriority, ElementStatus } from '@/types/database';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/ui/dropdown-menu';

// Sentinel used in the Object pill for the "My Elements (personal)" entry.
// Callers receive `personal: true` in the submit payload and translate that
// into an Element with `owner_id = me` + `object_id = null`.
const PERSONAL_SCOPE_ID = '__personal__';

// One submit payload entry — produced for every non-empty title line.
// Shared fields (description / status / priority / assignees / object /
// labels) come from the popup's pill row and apply to every entry.
export interface NewElementInput {
  title: string;
  description?: string | null;
  type?: string | null;
  status?: ElementStatus | null;
  priority?: ElementPriority | null;
  assigneeWorkerIds?: string[];
  objectId?: string | null;
  labels?: string[];
  /** True when the user picked "My Elements" in the Object pill — caller
   *  saves the Element to personal scope (owner_id = me, object_id = null). */
  personal?: boolean;
  /** From a picked Template — has no pill of its own, so the caller applies
   *  it directly to each created Element rather than folding it into the
   *  other shared fields. */
  estimatedHours?: number | null;
}

// A saved Element shape (Settings > Elements > Templates) offered from the
// popup's Template pill. Picking one resets every other pill to match — see
// `applyTemplate` below.
export interface QuickAddTemplate {
  id: string;
  name: string;
  type: string | null;
  status: ElementStatus | null;
  priority: ElementPriority | null;
  labels: string[];
  assigneeWorkerIds: string[];
  description: string | null;
  estimatedHours: number | null;
}

interface QuickAddElementPopupProps {
  open: boolean;
  /** Context label shown next to the title — e.g. an Object name. */
  contextLabel?: string;
  /** Hint shown under the textarea. Optional contextual guidance. */
  hint?: string;
  onClose: () => void;
  /** Receives one NewElementInput per non-empty line of the textarea. Shared
   *  rich fields (description / status / …) are copied into every entry so
   *  the caller can persist them on every created Element. */
  onSubmit: (inputs: NewElementInput[]) => void | Promise<void>;
  /** Domain-shared Element types for the Type pill (`domains.element_types`).
   *  Empty array hides the pill. */
  types?: string[];
  /** Worker list for the Assignee pill picker. Empty array hides the pill. */
  workers?: { id: string; name: string; avatar_url?: string | null }[];
  /** Object list for the Object pill picker. Empty array hides the pill. */
  objects?: { id: string; name: string }[];
  /** Known labels for the Labels pill picker (Domain-shared catalogue). */
  availableLabels?: string[];
  /** Saved shapes for the Template pill (Settings > Elements > Templates).
   *  Empty array (the default) hides the pill — a Domain with no templates
   *  looks exactly as it did before this feature existed. */
  templates?: QuickAddTemplate[];
  /** Pre-selected Object (e.g. when invoked from an Object detail's Elements
   *  tab — the Object pill starts on its parent). */
  defaultObjectId?: string | null;
  /** Pills the popup opens on when the caller already knows the answer —
   *  the "+" on a grouped section knows the band it was pressed in, so the
   *  new Element starts on that band's value instead of asking again. Each
   *  stays editable; passing null / an empty list just leaves the pill
   *  unset. */
  defaultType?: string | null;
  defaultStatus?: ElementStatus | null;
  defaultPriority?: ElementPriority | null;
  defaultAssigneeWorkerIds?: string[];
  defaultLabels?: string[];
  /** Seed the title textarea on open (e.g. a chat message being converted
   *  into an Element). */
  initialText?: string;
  /** When true, prepend a "My Elements (personal)" entry to the Object pill.
   *  Picking it sets `personal: true` on the submit payload; caller saves
   *  the Element with owner_id = me + object_id = null. Hidden by default
   *  (e.g. inside an Object detail page where personal makes no sense). */
  canSaveToPersonal?: boolean;
}


/**
 * Floating bottom-center popup for adding one or many Elements with rich
 * defaults (Linear's "New issue" pattern). Title textarea accepts multi-line
 * paste — each non-empty line becomes its own Element, all of them sharing
 * the description + Status / Priority / Assignee / Object / Labels chosen in
 * the pill row.
 *
 * Enter submits, Shift+Enter inserts a newline, Esc closes.
 */
export function QuickAddElementPopup({
  open,
  contextLabel,
  hint,
  onClose,
  onSubmit,
  types = [],
  workers = [],
  objects = [],
  availableLabels = [],
  templates = [],
  defaultObjectId = null,
  defaultType = null,
  defaultStatus = null,
  defaultPriority = null,
  defaultAssigneeWorkerIds,
  defaultLabels,
  initialText = '',
  canSaveToPersonal = false,
}: QuickAddElementPopupProps) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<string | null>(defaultType);
  const [status, setStatus] = useState<ElementStatus | null>(defaultStatus);
  const [priority, setPriority] = useState<ElementPriority | null>(defaultPriority);
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(() => new Set(defaultAssigneeWorkerIds));
  const [objectId, setObjectId] = useState<string | null>(defaultObjectId);
  const [labels, setLabels] = useState<Set<string>>(() => new Set(defaultLabels));
  // Set only by picking a Template — no pill of its own, carried straight
  // into the submit payload for the caller to apply post-create.
  const [estimatedHours, setEstimatedHours] = useState<number | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  useLabelColors(); // re-render when the Domain colour catalogue hydrates
  // Single-menu open state — opening any pill closes the others (Linear's
  // exclusive popover behaviour). Without this, Radix can keep adjacent
  // dropdowns open at the same time inside the same popup container.
  type MenuId = 'type' | 'status' | 'priority' | 'assignee' | 'object' | 'labels' | 'template';
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const menuProps = (id: MenuId) => ({
    open: openMenu === id,
    onOpenChange: (next: boolean) => setOpenMenu(next ? id : null),
  });
  const [busy, setBusy] = useState(false);
  // How many this sitting has produced. The popup staying open after a create
  // is otherwise indistinguishable from a create that silently failed.
  const [createdCount, setCreatedCount] = useState(0);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset to the caller's defaults + focus whenever the popup opens. Deps are
  // [open, defaultObjectId] — deliberately NOT onClose: the host hands us a
  // fresh onClose every render, so depending on it re-ran this effect on every
  // parent render and cancelled the pending focus timer before it landed (the
  // title field never got focus, so typing went nowhere). The `autoFocus` attr
  // on the title textarea is the primary focus path; the rAF here re-focuses
  // on an already-mounted reopen.
  useEffect(() => {
    if (!open) return;
    setText(initialText);
    setDescription('');
    setCreatedCount(0);
    setType(defaultType);
    setStatus(defaultStatus);
    setPriority(defaultPriority);
    setAssigneeIds(new Set(defaultAssigneeWorkerIds));
    setObjectId(defaultObjectId);
    setLabels(new Set(defaultLabels));
    setEstimatedHours(null);
    setTemplateId(null);
    const id = requestAnimationFrame(() => taRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // The remaining defaults are read on open only, and the two collection
    // props are fresh arrays every render — listing them would re-run this
    // effect (and wipe what the user just typed) on any parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultObjectId]);

  // Close on Esc — as a layer, so a picker opened from inside the popup takes
  // the key first and the popup gets the next one. Kept apart from the focus
  // effect above so its onClose dependency doesn't disturb it.
  useEscapeLayer(open, onClose);

  // Auto-grow the textareas up to a max height.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, [text]);
  useEffect(() => {
    const ta = descRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight, QUICK_CREATE.descriptionMinHeight), 240)}px`;
  }, [description]);

  const titles = useMemo(
    () => text.split('\n').map((s) => s.trim()).filter(Boolean),
    [text],
  );
  const canSubmit = titles.length > 0 && !busy;

  if (!open) return null;

  // Adding N things should not cost N trips to the "+".
  //
  // Enter creates and stays, because the common case is a list of things you
  // already have in your head. Only the title clears: the description and the
  // pills are the batch's shared context, so the second Element inherits
  // everything you set up for the first. ⌘Enter is the way out for the times
  // you only wanted one — create and close, no reach for Escape.
  // Picking a Template only fills in the fields it actually defines — it
  // never clears one the user already set. A blank field on the template
  // (e.g. one that only cares about Type + Priority) and "the user hasn't
  // touched Labels yet" are indistinguishable from the template's own data,
  // so a full reset would silently wipe labels/assignees/description the
  // user picked before reaching for the Template pill (e.g. typing three
  // titles, hand-picking two labels, then applying a template just to grab
  // its Priority). Applying the same template twice is idempotent either way.
  const applyTemplate = (t: QuickAddTemplate) => {
    setTemplateId(t.id);
    if (t.type !== null) setType(t.type);
    if (t.status !== null) setStatus(t.status);
    if (t.priority !== null) setPriority(t.priority);
    if (t.assigneeWorkerIds.length > 0) setAssigneeIds(new Set(t.assigneeWorkerIds));
    if (t.labels.length > 0) setLabels(new Set(t.labels));
    if (t.description) setDescription(t.description);
    if (t.estimatedHours !== null) setEstimatedHours(t.estimatedHours);
  };

  const handleSubmit = async (closeAfter: boolean) => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      // Translate the "Personal" sentinel into a real personal flag; clear
      // objectId so the caller doesn't try to FK a non-existent Object id.
      const isPersonal = objectId === PERSONAL_SCOPE_ID;
      const shared = {
        description: description.trim() || null,
        type,
        status,
        priority,
        assigneeWorkerIds: Array.from(assigneeIds),
        objectId: isPersonal ? null : objectId,
        labels: Array.from(labels),
        personal: isPersonal,
        estimatedHours,
      };
      const inputs: NewElementInput[] = titles.map((title) => ({ title, ...shared }));
      await onSubmit(inputs);
      if (closeAfter) {
        setText('');
        setDescription('');
        onClose();
        return;
      }
      setCreatedCount((n) => n + inputs.length);
      setText('');
      // Focus survives the re-render on its own, but not if the click came from
      // the Create button — put the caret back where the next title goes.
      taRef.current?.focus();
    } catch (e) {
      console.error('QuickAdd submit failed:', e);
    } finally {
      setBusy(false);
    }
  };

  const statusOpt = STATUS_OPTIONS.find((s) => s.value === status);
  const priorityOpt = PRIORITY_OPTIONS.find((p) => p.value === priority);
  const isPersonalChoice = objectId === PERSONAL_SCOPE_ID;
  const objectOpt = isPersonalChoice
    ? { id: PERSONAL_SCOPE_ID, name: t('My Elements') }
    : objectId ? objects.find((o) => o.id === objectId) ?? null : null;
  const assigneeCount = assigneeIds.size;
  const labelCount = labels.size;
  const showObjectPill = objects.length > 0 || canSaveToPersonal;

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none">
      <div
        className={QUICK_CREATE.panel}
        role="dialog"
        aria-label={t('Quick add Element')}
      >
        {/* Header — context chip + close */}
        <div className={QUICK_CREATE.header}>
          <span className={QUICK_CREATE.context}>
            <ElementIcon size={12} />
            <span className="truncate max-w-[200px]">{contextLabel ?? t('New Element')}</span>
          </span>
          {titles.length > 1 && (
            <span className="text-[11px] text-muted-foreground">{t('{n} Elements', { n: titles.length })}</span>
          )}
          {createdCount > 0 && (
            <span className="text-[11px] text-muted-foreground/70">
              {t('{n} added', { n: createdCount })}
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label={t('Close')}
          >
            <X size={14} />
          </button>
        </div>

        {/* Title — multi-line paste creates multiple Elements */}
        <textarea
          ref={taRef}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSubmit(e.metaKey || e.ctrlKey);
            }
          }}
          placeholder={t('Element title…')}
          aria-label={t('Element title')}
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

        {/* Pill row — Template / Type / Status / Priority / Assignee / Save to / Labels */}
        <div className={QUICK_CREATE.properties}>
          {/* Template — a saved shape (Settings > Elements > Templates).
              Picking one resets every pill it defines to match; the pill
              itself only ever shows the last-picked name, since applying a
              template is a one-time reset, not a persisted mode. */}
          {templates.length > 0 && (
            <DropdownMenu {...menuProps('template')}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={pillClass(!!templateId)}>
                  <LayoutTemplate size={11} />
                  <span>{templates.find((t) => t.id === templateId)?.name ?? t('Template')}</span>
                  <ChevronDown size={10} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="rounded-xl min-w-[180px]">
                <DropdownMenuLabel className="text-[10px] text-muted-foreground/70">{t('Template')}</DropdownMenuLabel>
                {templates.map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => applyTemplate(t)} className="gap-2 text-[12px]">
                    <span className="flex-1 truncate">{t.name}</span>
                    {templateId === t.id && <Check size={12} />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Type — Domain-shared catalogue (TASK / Feature / Fix / …).
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
              <DropdownMenuContent align="start" className="rounded-xl min-w-[180px]">
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

          {/* Status — uses the shared ElementProgressMark so the popup chip
              matches what the list / detail surfaces show for the same value. */}
          <DropdownMenu {...menuProps('status')}>
            <DropdownMenuTrigger asChild>
              <button type="button" className={pillClass(!!statusOpt)}>
                <ElementProgressMark status={status} size={13} />
                <span>{statusOpt ? t(statusOpt.label) : t('Status')}</span>
                <ChevronDown size={10} className="opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="rounded-xl min-w-[180px]">
              <DropdownMenuLabel className="text-[10px] text-muted-foreground/70">{t('Status')}</DropdownMenuLabel>
              {STATUS_OPTIONS.map((s) => (
                <DropdownMenuItem key={s.value} onSelect={() => setStatus(s.value)} className="gap-2 text-[12px]">
                  <ElementProgressMark status={s.value} size={13} />
                  <span className="flex-1">{t(s.label)}</span>
                  {status === s.value && <Check size={12} />}
                </DropdownMenuItem>
              ))}
              {status && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setStatus(null)} className="text-[12px] text-muted-foreground">{t('Clear')}</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Priority — the shared PriorityPicker: identical menu (incl. a
              "No priority" row) to the list cell and every other surface. */}
          <PriorityPicker
            {...menuProps('priority')}
            value={priority}
            onChange={(p) => setPriority(p as ElementPriority | null)}
            trigger={
              <button type="button" className={pillClass(!!priorityOpt)}>
                <PriorityMark priority={priority} />
                <span>{priorityOpt ? t(priorityOpt.label) : t('Priority')}</span>
                <ChevronDown size={10} className="opacity-60" />
              </button>
            }
          />

          {/* Assignee (multi-select) — hidden when no workers available. */}
          {workers.length > 0 && (
            <DropdownMenu {...menuProps('assignee')}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={workerTriggerLabel(t('Assignee'), workers.filter((w) => assigneeIds.has(w.id)))}
                  className={pillClass(assigneeCount > 0)}
                >
                  <UserIcon size={12} className="text-muted-foreground" />
                  <span>
                    {assigneeCount === 0
                      ? t('Assignee')
                      : assigneeCount === 1
                      ? workers.find((w) => w.id === Array.from(assigneeIds)[0])?.name ?? t('1 assignee')
                      : t('{n} assignees', { n: assigneeCount })}
                  </span>
                  <ChevronDown size={10} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="rounded-xl min-w-[220px] max-h-[260px] overflow-y-auto">
                <DropdownMenuLabel className="text-[10px] text-muted-foreground/70">{t('Assignee')}</DropdownMenuLabel>
                {workers.map((w) => {
                  const on = assigneeIds.has(w.id);
                  return (
                    <DropdownMenuItem
                      key={w.id}
                      onSelect={(e) => { e.preventDefault(); toggleSet(setAssigneeIds, w.id); }}
                      className="gap-2 text-[12px]"
                    >
                      <WorkerAvatar worker={w} size={16} />
                      <span className="flex-1 truncate">{w.name}</span>
                      <ReachHint worker={w} />
                      {on && <Check size={12} />}
                    </DropdownMenuItem>
                  );
                })}
                {assigneeCount > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setAssigneeIds(new Set())} className="text-[12px] text-muted-foreground">{t('Clear')}</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Object — "Save to". Includes a "My Elements (personal)" entry
              at the top when the caller allows it (canSaveToPersonal). */}
          {showObjectPill && (
            <DropdownMenu {...menuProps('object')}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={pillClass(!!objectOpt)}>
                  {isPersonalChoice
                    ? <NavMyTasksIcon size={12} />
                    : <BoxIcon size={12} className="text-muted-foreground" />}
                  <span>{objectOpt?.name ?? t('Save to')}</span>
                  <ChevronDown size={10} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="rounded-xl min-w-[240px] max-h-[260px] overflow-y-auto">
                <DropdownMenuLabel className="text-[10px] text-muted-foreground/70">{t('Save to')}</DropdownMenuLabel>
                {canSaveToPersonal && (
                  <>
                    <DropdownMenuItem onSelect={() => setObjectId(PERSONAL_SCOPE_ID)} className="gap-2 text-[12px]">
                      <NavMyTasksIcon size={12} />
                      <span className="flex-1 truncate">{t('My Elements (personal)')}</span>
                      {isPersonalChoice && <Check size={12} />}
                    </DropdownMenuItem>
                    {objects.length > 0 && <DropdownMenuSeparator />}
                  </>
                )}
                {objects.map((o) => (
                  <DropdownMenuItem key={o.id} onSelect={() => setObjectId(o.id)} className="gap-2 text-[12px]">
                    <BoxIcon size={12} className="text-muted-foreground" />
                    <span className="flex-1 truncate">{o.name}</span>
                    {objectId === o.id && <Check size={12} />}
                  </DropdownMenuItem>
                ))}
                {(objectOpt && !isPersonalChoice) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setObjectId(null)} className="text-[12px] text-muted-foreground">{t('Clear (Domain-direct)')}</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Labels (multi-select) */}
          {availableLabels.length > 0 && (
            <DropdownMenu {...menuProps('labels')}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={pillClass(labelCount > 0)}>
                  <TagIcon size={12} className="text-muted-foreground" />
                  <span>{labelCount === 0 ? t('Labels') : t(labelCount === 1 ? '{n} label' : '{n} labels', { n: labelCount })}</span>
                  <ChevronDown size={10} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="rounded-xl min-w-[220px] max-h-[260px] overflow-y-auto">
                <DropdownMenuLabel className="text-[10px] text-muted-foreground/70">{t('Labels')}</DropdownMenuLabel>
                {availableLabels.map((l) => {
                  const on = labels.has(l);
                  return (
                    <DropdownMenuItem
                      key={l}
                      onSelect={(e) => { e.preventDefault(); toggleSet(setLabels, l); }}
                      className="gap-2 text-[12px]"
                    >
                      <TagIcon size={12} className="shrink-0" style={{ color: labelColor(l) }} />
                      <span className="flex-1 truncate">{l}</span>
                      {on && <Check size={12} />}
                    </DropdownMenuItem>
                  );
                })}
                {labelCount > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setLabels(new Set())} className="text-[12px] text-muted-foreground">{t('Clear')}</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className={QUICK_CREATE.footer}>
          {hint && <span className="mr-auto min-w-0 text-[11px] text-muted-foreground">{hint}</span>}
          <Button variant="primary" onClick={() => handleSubmit(false)} disabled={!canSubmit}>
            {titles.length > 1 ? t('Create {n}', { n: titles.length }) : t('Create')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Tailwind for pill triggers — semibold + brighter text, soft-fill at rest.

function toggleSet<T>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, value: T) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
}

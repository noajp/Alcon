'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Milestone, Plus, User, X } from 'lucide-react';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { Button } from '@/ui/button';
import { ElementIcon, ObjectIcon } from '@/Function/shared/conceptIcons';
import { MenuShell, MenuSectionLabel, MENU_ROW, MENU_SEPARATOR } from '@/Function/shared/menu';

// =============================================================
// The two halves of a binding control: the picker that adds one, and the chip
// that shows one. Kept together because they share the vocabulary — a target is
// one of four kinds of thing, and it looks the same being chosen as it does
// once chosen.
//
// The four are not interchangeable, which is the point. An Object or an Element
// is work; a Phase is a time box; a Worker is a person. An intent whose subject
// is a person has nowhere to land among the first three — "only she has done
// this before" is not a statement about any Element, and binding it to one
// would put the claim next to something that cannot contradict it.
//
// The picker:
//
// One list, grouped by kind, filtered as you type. Already-bound targets are
// not shown: the table's unique index would reject the second write anyway, and
// offering a row that cannot be chosen is worse than not offering it.
//
// Keyboard is hand-rolled rather than delegated. A Radix popover gives Escape
// and focus containment but no roving highlight, and this list is long enough
// that arrowing through it is how it gets used once there are more than a few
// Objects — the shape follows `InlineAddRow`'s `@` menu, which is the pattern
// already in the codebase.
// =============================================================

/** The kinds a binding surface offers. `intent_bindings.target_type` also takes
 *  `domain`; nothing writes one, so nothing here offers one. */
export type PickerTargetType = 'object' | 'element' | 'worker' | 'phase';

export interface PickerTarget {
  type: PickerTargetType;
  id: string;
  label: string;
  /** The disambiguator — an Element's display id, a Worker's role, a Phase's
   *  period. Elements in different Objects routinely carry the same title. */
  hint: string | null;
}

/** The glyph per kind. A Worker gets a figure rather than their avatar: at
 *  11px the mark's job is to say which kind of thing a row is, and an initial
 *  answers a different question in a list that mixes four. */
const GLYPH = {
  object: ObjectIcon,
  element: ElementIcon,
  worker: User,
  phase: Milestone,
} as const;

/** Group order, and the heading each group carries. */
const GROUPS: { type: PickerTargetType; label: string }[] = [
  { type: 'object', label: 'Objects' },
  { type: 'element', label: 'Elements' },
  { type: 'worker', label: 'Workers' },
  { type: 'phase', label: 'Phases' },
];

/**
 * One bound target, as it reads on the section.
 *
 * Two controls in one chip: the label opens the target, the `×` unlinks it. The
 * `×` is nested rather than placed beside the chip because the pair is one
 * object — a detached remove button next to a row of chips has to be aimed at
 * the right one, and at this size that aim is guesswork.
 *
 * `signal` is whatever the caller has read off the target's own state. This
 * component does not compute it; the assumption section passes one and the
 * decision section passes none, which is the difference between "watching this"
 * and "this is where the decision landed". Its `title` carries the reading in
 * full where the badge had to abbreviate it — "Away 12d" is not a number
 * anybody can size without knowing what it is 12 out of.
 */
export function BoundTarget({
  type,
  label,
  hint,
  signal,
  onOpen,
  onRemove,
}: {
  type: PickerTargetType;
  label: string;
  hint: string | null;
  signal?: { text: string; tone: string; title?: string } | null;
  onOpen?: () => void;
  /** Absent for a reader who may not change the Initiative — the chip
   *  then shows the link without offering to break it. */
  onRemove?: () => void;
}) {
  const Icon = GLYPH[type];
  return (
    <span className="inline-flex items-center gap-1 h-6 pl-1.5 pr-0.5 rounded-md bg-[var(--surface-strong)] max-w-full">
      <Icon size={11} className="text-muted-foreground shrink-0" />
      <button
        type="button"
        disabled={!onOpen}
        onClick={onOpen}
        title={hint ? `${label} · ${hint}` : label}
        className="text-[12px] text-foreground truncate min-w-0 max-w-48 disabled:pointer-events-none"
      >
        {label}
      </button>
      {signal && (
        <span
          title={signal.title}
          className={`text-[11px] font-medium shrink-0 ${signal.tone}`}
        >
          {signal.text}
        </span>
      )}
      {onRemove ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Unlink ${label}`}
          onClick={onRemove}
          className="size-5 shrink-0"
        >
          <X size={11} />
        </Button>
      ) : (
        <span className="w-1" aria-hidden />
      )}
    </span>
  );
}

export function IntentTargetPicker({
  label,
  targets,
  onPick,
  disabled = false,
  empty,
}: {
  /** The trigger's text. Says what the link will mean, not "Add". */
  label: string;
  /** Candidates, already stripped of anything bound. */
  targets: PickerTarget[];
  onPick: (target: PickerTarget) => void;
  disabled?: boolean;
  /** What to say when there is nothing left to link. */
  empty: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter(
      (t) =>
        t.label.toLowerCase().includes(q) || (t.hint ?? '').toLowerCase().includes(q),
    );
  }, [targets, query]);

  // The groups render as one keyboard list, so a row's position in it is its
  // index in this flattened order — built once so the highlight and the render
  // cannot disagree about where a row sits.
  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({ ...g, rows: matches.filter((t) => t.type === g.type) })).filter(
        (g) => g.rows.length > 0,
      ),
    [matches],
  );
  const ordered = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  function choose(target: PickerTarget) {
    onPick(target);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, ordered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = ordered[cursor];
      if (target) choose(target);
    }
  }

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-cursor="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const row = (target: PickerTarget, at: number) => {
    const Icon = GLYPH[target.type];
    return (
      <button
        key={`${target.type}:${target.id}`}
        type="button"
        data-cursor={at === cursor}
        onMouseEnter={() => setCursor(at)}
        onClick={() => choose(target)}
        className={`${MENU_ROW} ${at === cursor ? 'bg-[var(--surface-strong)]' : ''}`}
      >
        <Icon size={13} className="text-muted-foreground shrink-0" />
        <span className="truncate min-w-0 flex-1">{target.label}</span>
        {target.hint && (
          <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
            {target.hint}
          </span>
        )}
      </button>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" disabled={disabled} className="text-muted-foreground">
          <Plus size={12} />
          {label}
        </Button>
      </PopoverTrigger>
      <MenuShell align="start" className="p-0">
        {/* No ring, no border, no ground (DESIGN.md §5.3). The field is the only
            thing above the divider, so where the caret is was never in doubt. */}
        <input
          value={query}
          autoFocus
          onChange={(e) => {
            setQuery(e.target.value);
            // The highlight is a position in a list that shrinks as you type,
            // so it goes back to the top with every keystroke. Left where it
            // was, Enter would pick a row the reader can no longer see.
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search this Initiative"
          aria-label="Search this Initiative"
          className="w-full h-9 px-2 bg-transparent border-none text-[13px] text-foreground placeholder:text-muted-foreground/60"
        />
        <div className={`${MENU_SEPARATOR} mx-0`} />
        <div ref={listRef} className="max-h-48 overflow-y-auto p-1">
          {ordered.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] text-muted-foreground/60">
              {targets.length === 0 ? empty : 'Nothing matches.'}
            </p>
          ) : (
            groups.map((group, gi) => {
              const before = groups.slice(0, gi).reduce((n, g) => n + g.rows.length, 0);
              return (
                <div key={group.type}>
                  {/* A single group needs no heading — the picker was opened
                      for one kind of thing and every row is that kind. */}
                  {groups.length > 1 && <MenuSectionLabel>{group.label}</MenuSectionLabel>}
                  {group.rows.map((t, i) => row(t, before + i))}
                </div>
              );
            })
          )}
        </div>
      </MenuShell>
    </Popover>
  );
}

'use client';

import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type { CustomColumn, CustomColumnType } from '@/types/database';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { MenuShell, MenuSectionLabel, MENU_ROW, MENU_SEPARATOR } from '@/Function/shared/menu';
import { COLUMN_TYPES, BUILTIN_COLUMN_ICONS } from './columnTypes';

// Compact "add property" menu — shared by the Element/Object detail rail
// (AddPropertyButton, a popover) and the list column picker (AddColumnModal).
// Layout mirrors the Label add popover: a name field on top, a type list
// below. Clicking a type creates the property immediately (falling back to
// the type label when the name is blank — custom columns can be renamed).

type RestoreBuiltInType = 'assignees' | 'priority' | 'status' | 'due_date';

// Task/record-level types that don't belong on an Object (Project-level), and
// vice-versa. Mirrors AddColumnModal's scope split.
const ELEMENT_ONLY_TYPES: CustomColumnType[] = ['checkbox', 'url', 'email', 'phone', 'progress'];
const OBJECT_ONLY_TYPES: CustomColumnType[] = ['budget'];
// Retired from the picker everywhere (covered by built-ins).
const HIDDEN_TYPES: CustomColumnType[] = ['progress', 'date'];

export interface AddPropertyMenuProps {
  scope?: 'object' | 'element';
  onAdd: (name: string, type: CustomColumnType, opts?: { toLibrary?: boolean }) => void;
  /** Closes the host popover/modal after a pick. */
  onClose?: () => void;
  /** Space library columns not yet on this list — the "From library" section.
   *  Clicking one places the existing field here (its Element values appear
   *  immediately, Asana add-existing-field style). */
  libraryColumns?: CustomColumn[];
  onAddExisting?: (columnId: string) => void;
  /** Offer the "Save to Space library" toggle when creating a new property. */
  allowLibrary?: boolean;
  /** Hidden built-in columns offered as a "Restore" section (list views only). */
  deletedBuiltInColumns?: { id: string; name: string; builtinType: RestoreBuiltInType }[];
  onRestoreBuiltIn?: (builtinType: RestoreBuiltInType) => void;
}

/** The menu body (input + type list). Render inside a Popover or a panel. */
export function AddPropertyMenu({
  scope = 'element',
  onAdd,
  onClose,
  libraryColumns,
  onAddExisting,
  allowLibrary,
  deletedBuiltInColumns,
  onRestoreBuiltIn,
}: AddPropertyMenuProps) {
  const [name, setName] = useState('');
  const [toLibrary, setToLibrary] = useState(false);

  const inScope = (t: CustomColumnType) =>
    (scope === 'object' ? !ELEMENT_ONLY_TYPES.includes(t) : !OBJECT_ONLY_TYPES.includes(t)) &&
    !HIDDEN_TYPES.includes(t);
  const types = COLUMN_TYPES.filter((t) => inScope(t.type));
  const restorable = deletedBuiltInColumns ?? [];
  const library = libraryColumns ?? [];

  const create = (type: CustomColumnType) => {
    const label = COLUMN_TYPES.find((t) => t.type === type)?.label ?? 'Field';
    onAdd(name.trim() || label, type, toLibrary ? { toLibrary: true } : undefined);
    setName('');
    onClose?.();
  };

  const typeIcon = (t: CustomColumnType) => COLUMN_TYPES.find((c) => c.type === t)?.icon ?? null;

  return (
    <>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Property name…"
        autoFocus
        className="w-full px-2 py-1 text-[13px] bg-muted/40 rounded-md border-none placeholder:text-muted-foreground/60"
      />
      {/* The list scrolls on its own so the name field stays pinned. `mx-0` on
          the dividers inside cancels MENU_SEPARATOR's bleed: a -4px margin
          here is wider than this box and raises a horizontal scrollbar. */}
      <div className="mt-1 max-h-72 overflow-y-auto overflow-x-hidden">
        {restorable.length > 0 && (
          <>
            <MenuSectionLabel>Restore default property</MenuSectionLabel>
            {restorable.map((col) => (
              <button
                key={col.id}
                type="button"
                onClick={() => { onRestoreBuiltIn?.(col.builtinType); onClose?.(); }}
                className={MENU_ROW}
              >
                <span className="text-muted-foreground shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                  {BUILTIN_COLUMN_ICONS[col.builtinType]}
                </span>
                <span className="truncate flex-1">{col.name}</span>
                <span className="text-[10px] text-muted-foreground/70 shrink-0">Built-in</span>
              </button>
            ))}
            <div className={`${MENU_SEPARATOR} mx-0`} />
          </>
        )}
        {library.length > 0 && onAddExisting && (
          <>
            <MenuSectionLabel>From library</MenuSectionLabel>
            {library.map((col) => (
              <button
                key={col.id}
                type="button"
                onClick={() => { onAddExisting(col.id); onClose?.(); }}
                className={MENU_ROW}
              >
                <span className="text-muted-foreground shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                  {typeIcon(col.column_type)}
                </span>
                <span className="truncate flex-1">{col.name}</span>
                <span className="text-[10px] text-muted-foreground/70 shrink-0">Library</span>
              </button>
            ))}
            <div className={`${MENU_SEPARATOR} mx-0`} />
          </>
        )}
        <MenuSectionLabel>Select type</MenuSectionLabel>
        {types.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => create(t.type)}
            className={MENU_ROW}
          >
            <span className="text-muted-foreground shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">{t.icon}</span>
            <span className="truncate flex-1">{t.label}</span>
          </button>
        ))}
      </div>
      {allowLibrary && (
        <>
          <div className={MENU_SEPARATOR} />
          <button
            type="button"
            onClick={() => setToLibrary((v) => !v)}
            className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors select-none"
          >
            <span
              className={`size-3 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors ${
                toLibrary
                  ? 'bg-foreground border-foreground text-background'
                  : 'border-muted-foreground/40'
              }`}
            >
              {toLibrary && <Check size={8} strokeWidth={3.5} />}
            </span>
            Save to Space library
          </button>
        </>
      )}
    </>
  );
}

/** Popover-triggered "+" used in the Element/Object detail Properties rail. */
export function AddPropertyButton({
  scope = 'element',
  onAdd,
}: {
  scope?: 'object' | 'element';
  onAdd: (name: string, type: CustomColumnType) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add property"
          title="Add property"
          className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
        >
          <Plus size={13} strokeWidth={2.5} />
        </button>
      </PopoverTrigger>
      <MenuShell align="end">
        <AddPropertyMenu scope={scope} onAdd={onAdd} onClose={() => setOpen(false)} />
      </MenuShell>
    </Popover>
  );
}

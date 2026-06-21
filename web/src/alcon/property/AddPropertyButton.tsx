'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { CustomColumnType } from '@/types/database';
import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';
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
  onAdd: (name: string, type: CustomColumnType) => void;
  /** Closes the host popover/modal after a pick. */
  onClose?: () => void;
  /** Hidden built-in columns offered as a "Restore" section (list views only). */
  deletedBuiltInColumns?: { id: string; name: string; builtinType: RestoreBuiltInType }[];
  onRestoreBuiltIn?: (builtinType: RestoreBuiltInType) => void;
}

/** The menu body (input + type list). Render inside a Popover or a panel. */
export function AddPropertyMenu({
  scope = 'element',
  onAdd,
  onClose,
  deletedBuiltInColumns,
  onRestoreBuiltIn,
}: AddPropertyMenuProps) {
  const [name, setName] = useState('');

  const inScope = (t: CustomColumnType) =>
    (scope === 'object' ? !ELEMENT_ONLY_TYPES.includes(t) : !OBJECT_ONLY_TYPES.includes(t)) &&
    !HIDDEN_TYPES.includes(t);
  const types = COLUMN_TYPES.filter((t) => inScope(t.type));
  const restorable = deletedBuiltInColumns ?? [];

  const create = (type: CustomColumnType) => {
    const label = COLUMN_TYPES.find((t) => t.type === type)?.label ?? 'Field';
    onAdd(name.trim() || label, type);
    setName('');
    onClose?.();
  };

  return (
    <>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Property name…"
        autoFocus
        className="w-full px-2 py-1 text-[13px] bg-muted/40 rounded-md placeholder:text-muted-foreground/60"
      />
      <div className="mt-1 max-h-72 overflow-auto">
        {restorable.length > 0 && (
          <>
            <div className="px-2 py-1 text-[11px] text-muted-foreground/60">Restore default property</div>
            {restorable.map((col) => (
              <button
                key={col.id}
                type="button"
                onClick={() => { onRestoreBuiltIn?.(col.builtinType); onClose?.(); }}
                className="w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted/40 text-[13px] text-left"
              >
                <span className="text-muted-foreground shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                  {BUILTIN_COLUMN_ICONS[col.builtinType]}
                </span>
                <span className="truncate flex-1">{col.name}</span>
                <span className="text-[10px] text-muted-foreground/70 shrink-0">Built-in</span>
              </button>
            ))}
            <div className="my-1 border-t border-border/60" />
          </>
        )}
        <div className="px-2 py-1 text-[11px] text-muted-foreground/60">Select type</div>
        {types.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => create(t.type)}
            className="w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted/40 text-[13px] text-left"
          >
            <span className="text-muted-foreground shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">{t.icon}</span>
            <span className="truncate flex-1">{t.label}</span>
          </button>
        ))}
      </div>
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
      <PopoverContent align="end" className="w-60 p-1.5">
        <AddPropertyMenu scope={scope} onAdd={onAdd} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

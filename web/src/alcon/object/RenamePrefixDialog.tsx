'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { supabase } from '@/lib/supabase';
import { updateObject, type AlconObjectWithChildren } from '@/hooks/useSupabase';

interface RenamePrefixDialogProps {
  object: AlconObjectWithChildren;
  onClose: () => void;
  onRenamed: () => void | Promise<void>;
}

// A handful of Objects ended up with a broken prefix (el_QLT-012) — a CJK
// name mangled through generate_prefix (e.g. "医療安全" → "P1—こ"), or a
// prefix nobody would pick on purpose ("開発PJ"). The set_object_display_id
// trigger only auto-generates + dedupes a prefix when the column is
// null/empty; hand it a non-empty value and it takes it verbatim with no
// uniqueness check — so this dialog does that check itself before writing.
// Forward-only, matching how the ELE_/OBJ_ display_id prefix change was
// handled: existing Elements keep their already-baked display_id; only the
// Object's own prefix (and new Elements' ids from here on) changes.
export function RenamePrefixDialog({ object, onClose, onRenamed }: RenamePrefixDialogProps) {
  const [value, setValue] = useState(object.prefix ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = value.trim().toUpperCase();
  const changed = normalized !== (object.prefix ?? '').toUpperCase();

  const save = async () => {
    if (!normalized) {
      setError("Prefix can't be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Resolve this Object's own Space via its Domain — NOT the global
      // "active Space" (activeSpaceStore): that's whichever Space the
      // SpaceSwitcher happens to be on, which need not be the Space this
      // Object's Domain actually belongs to. Using the active-Space store
      // here let a same-name collision through in practice (confirmed live
      // before this fix), since the active Space at save time didn't match
      // the Object's own.
      let spaceId: string | null = null;
      if (object.domain_id) {
        const { data: domainRow, error: domainError } = await supabase
          .from('domains')
          .select('activity_space_id')
          .eq('id', object.domain_id)
          .maybeSingle();
        if (domainError) throw domainError;
        spaceId = domainRow?.activity_space_id ?? null;
      }
      // Same scope the trigger's own auto-generate branch dedupes against:
      // every Object's prefix across every Domain in this Space, matched
      // NULL-safe like the trigger's `is not distinct from` (a Domain-less
      // Object's own spaceId is null too, and should still collide with
      // another Domain-less Object sharing the prefix). objects↔domains has
      // two embeddable paths (direct domain_id FK, and the object_domains
      // multi-home junction) — pin to the direct FK, matching the trigger's
      // own scope (`domains d where d.id = new.domain_id`, not the
      // junction). Left (not inner) join + a client-side NULL-safe compare,
      // not `.eq`/`.is` in the query: an inner join would silently drop
      // Domain-less candidates from the result instead of comparing them.
      const { data, error: queryError } = await supabase
        .from('objects')
        .select('id, domains!objects_domain_id_fkey(activity_space_id)')
        .neq('id', object.id)
        .ilike('prefix', normalized);
      if (queryError) throw queryError;
      const collides = (data ?? []).some((row) => {
        // A many-to-one embed resolves to one object at runtime, but the
        // untyped client's inferred shape is an array — normalize both.
        const embedded = Array.isArray(row.domains) ? row.domains[0] : row.domains;
        const rowSpaceId = (embedded as { activity_space_id: string | null } | undefined)?.activity_space_id ?? null;
        return rowSpaceId === spaceId;
      });
      if (collides) {
        setError(`"${normalized}" is already used by another Object in this Space.`);
        setBusy(false);
        return;
      }
      await updateObject(object.id, { prefix: normalized });
      await onRenamed();
      onClose();
    } catch (e) {
      console.error('Failed to rename prefix', e);
      setError('Failed to save — try again.');
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename ID prefix</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-muted-foreground">
            Changes new Elements&apos; ids from here on
            {object.prefix ? ` (el_${object.prefix}-… → el_${normalized || '…'}-…)` : ''}.
            Existing Elements keep their current ids.
          </p>
          <Input
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && changed && !busy) save();
            }}
            placeholder="Prefix"
            maxLength={12}
            autoFocus
          />
          {error && <div className="text-[11px] text-destructive">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="primary" size="sm" disabled={!changed || busy} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

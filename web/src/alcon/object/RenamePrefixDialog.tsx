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
  onRenamed: () => void;
}

const PREFIX_PATTERN = /^[A-Z0-9]+$/;

// A many-to-one embed (Object → its one Domain) resolves to a single object
// at runtime; the untyped client's inferred shape is an array. Normalize.
function unwrapDomain(embed: unknown): { activity_space_id: string | null } | null {
  const row = Array.isArray(embed) ? embed[0] : embed;
  return (row as { activity_space_id: string | null } | undefined) ?? null;
}

// A handful of Objects ended up with a broken prefix (el_QLT-012) — a CJK
// name mangled through generate_prefix (e.g. "医療安全" → "P1—こ", a real
// collision already hit once in el_UXQ-026: "TF-AIR"/"TF-MED"/"TF-LOG" all
// collapsed to "T—"), or a prefix nobody would pick on purpose ("開発PJ").
// The set_object_display_id trigger only auto-generates + dedupes a prefix
// when the column is null/empty; hand it a non-empty value and it takes it
// verbatim with no uniqueness check — so this dialog does that check itself
// before writing. Forward-only, matching how the ELE_/OBJ_ display_id
// prefix change was handled: existing Elements keep their already-baked
// display_id; only the Object's own prefix (and new Elements' ids from
// here on) changes.
//
// Known gap, accepted for this pass: the check-then-write below is plain
// client-side SELECT-then-UPDATE, not wrapped in the pg_advisory_xact_lock
// the auto-generate path already uses (supabase/migrations/
// 20260903000000_object_prefix_advisory_lock.sql) — that lock only guards
// the trigger's `prefix is null` branch, which a manual rename never takes.
// Two people renaming different Objects to the same prefix within the same
// request round-trip can both pass this check before either write lands.
// The SELECT is also RLS-scoped to the caller: an Object in a private
// Domain the caller isn't a member of won't be seen, so a collision against
// it goes undetected. Closing both needs a SECURITY DEFINER RPC that does
// the check + write atomically under the same lock, mirroring that
// migration — filed as a follow-up rather than folded into this pass, since
// a manual, human-initiated rename via this dialog is a narrow surface to
// race on in practice, and this is materially better than the status quo
// (no way to fix a broken prefix at all).
export function RenamePrefixDialog({ object, onClose, onRenamed }: RenamePrefixDialogProps) {
  const [value, setValue] = useState(object.prefix ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = value.trim().toUpperCase();
  const canSave = normalized !== (object.prefix ?? '').toUpperCase() && !busy;

  const save = async () => {
    if (!normalized) {
      setError("Prefix can't be empty.");
      return;
    }
    if (!PREFIX_PATTERN.test(normalized)) {
      setError('Prefix can only contain letters and numbers — the whole point is avoiding another unreadable id.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // One query, not two: this Object's own row (to learn its Space) and
      // every Object sharing the candidate prefix, in a single round trip.
      // Prefix match is a plain `eq`, not `ilike` — a LIKE pattern would
      // treat a literal `_` or `%` typed by the user as a wildcard instead
      // of a literal character, which the character check above already
      // rules out, but `eq` also just matches the trigger's own exact
      // `upper(o.prefix) = any(taken)` comparison more precisely than a
      // pattern match would. objects↔domains has two embeddable paths
      // (direct domain_id FK, and the object_domains multi-home junction) —
      // pin to the direct FK, matching the trigger's own scope (`domains d
      // where d.id = new.domain_id`, not the junction).
      const { data, error: queryError } = await supabase
        .from('objects')
        .select('id, prefix, domains!objects_domain_id_fkey(activity_space_id)')
        .or(`id.eq.${object.id},prefix.eq.${normalized}`);
      if (queryError) throw queryError;
      const rows = data ?? [];
      const mine = rows.find((row) => row.id === object.id);
      const spaceId = unwrapDomain(mine?.domains)?.activity_space_id ?? null;
      // NULL-safe like the trigger's `is not distinct from` — a Domain-less
      // Object's own spaceId is null too, and should still collide with
      // another Domain-less Object sharing the prefix.
      const collides = rows.some((row) => {
        if (row.id === object.id) return false;
        if ((row.prefix ?? '').toUpperCase() !== normalized) return false;
        return (unwrapDomain(row.domains)?.activity_space_id ?? null) === spaceId;
      });
      if (collides) {
        setError(`"${normalized}" is already used by another Object in this Space.`);
        setBusy(false);
        return;
      }
      await updateObject(object.id, { prefix: normalized });
      // Close as soon as the write itself is confirmed — the caller's list
      // refresh (onRenamed) has no bearing on whether the save succeeded,
      // so don't make the user wait through a second round trip to see the
      // dialog dismiss.
      onClose();
      onRenamed();
    } catch (e) {
      console.error('Failed to rename prefix', e);
      setError(e instanceof Error ? e.message : 'Failed to save — try again.');
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
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
              if (e.key === 'Enter' && canSave) save();
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
            <Button type="button" variant="primary" size="sm" disabled={!canSave} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

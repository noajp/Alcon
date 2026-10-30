'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { renameObjectPrefix, type AlconObjectWithChildren } from '@/hooks/useSupabase';

interface RenamePrefixDialogProps {
  object: AlconObjectWithChildren;
  onClose: () => void;
  onRenamed: () => void;
}

const PREFIX_PATTERN = /^[A-Z0-9]+$/;

// A handful of Objects ended up with a broken prefix (el_QLT-012) — a CJK
// name mangled through generate_prefix (e.g. "医療安全" → "P1—こ", a real
// collision already hit once in el_UXQ-026: "TF-AIR"/"TF-MED"/"TF-LOG" all
// collapsed to "T—"), or a prefix nobody would pick on purpose ("開発PJ").
// The set_object_display_id trigger only auto-generates + dedupes a prefix
// when the column is null/empty; hand it a non-empty value and it takes it
// verbatim with no uniqueness check — so this dialog checks uniqueness
// itself, via the rename_object_prefix RPC (ELE_QLT-038), before writing.
// Forward-only, matching how the ELE_/OBJ_ display_id prefix change was
// handled: existing Elements keep their already-baked display_id; only the
// Object's own prefix (and new Elements' ids from here on) changes.
//
// The check and the write happen inside the RPC's one transaction, under
// the same pg_advisory_xact_lock the auto-generate trigger already uses
// (supabase/migrations/20260903000000_object_prefix_advisory_lock.sql) —
// see the RPC's own migration (20260905010000_object_prefix_rename_rpc.sql)
// for why a client-side SELECT-then-UPDATE couldn't close that race or see
// past the caller's own RLS visibility.
export function RenamePrefixDialog({ object, onClose, onRenamed }: RenamePrefixDialogProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(object.prefix ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = value.trim().toUpperCase();
  const canSave = normalized !== (object.prefix ?? '').toUpperCase() && !busy;

  const save = async () => {
    if (!normalized) {
      setError(t('Prefix can’t be empty.'));
      return;
    }
    if (!PREFIX_PATTERN.test(normalized)) {
      setError(t('Prefix can only contain letters and numbers — the whole point is avoiding another unreadable id.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await renameObjectPrefix(object.id, normalized);
      // Close as soon as the write itself is confirmed — the caller's list
      // refresh (onRenamed) has no bearing on whether the save succeeded,
      // so don't make the user wait through a second round trip to see the
      // dialog dismiss.
      onClose();
      onRenamed();
    } catch (e) {
      console.error('Failed to rename prefix', e);
      const code = (e as { code?: string } | null)?.code;
      setError(
        code === '23505'
          ? t('“{prefix}” is already used by another Object in this Space.', { prefix: normalized })
          : e instanceof Error
            ? e.message
            : t('Failed to save — try again.'),
      );
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Rename ID prefix')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-muted-foreground">
            {object.prefix
              ? t('Changes new Elements’ ids from here on ({from} → {to}). Existing Elements keep their current ids.', { from: `el_${object.prefix}-…`, to: `el_${normalized || '…'}-…` })
              : t('Changes new Elements’ ids from here on. Existing Elements keep their current ids.')}
          </p>
          <Input
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) save();
            }}
            placeholder={t('Prefix')}
            maxLength={12}
            autoFocus
          />
          {error && <div className="text-[11px] text-destructive">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              {t('Cancel')}
            </Button>
            <Button type="button" variant="primary" size="sm" disabled={!canSave} onClick={save}>
              {t('Save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

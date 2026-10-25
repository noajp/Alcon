'use client';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createCustomColumn, updateCustomColumn, deleteCustomColumn, setCustomColumnValue, fetchCustomColumnsWithValues, isPropertyWriteRefused, noticePropertyValueFailed, type CustomColumnWithValues } from '@/hooks/useSupabase';
import { revealCustomColumn } from '@/ActivitySpace/execution/object/useListColumns';
import type { Json } from '@/types/database';
import { Button } from '@/ui/button';
import { ObjectFieldDialog } from './ObjectFieldDialog';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { type FieldDraft } from './fieldModel';
export type ColumnScope = { kind: 'object'; objectId: string };

/** Definitions belong to an Object; visibility belongs to the current view. */
export function useCustomColumns(scope: ColumnScope | null, options: { colStorageKey?: string } = {}) {
  const { t } = useI18n();
  const objectId = scope?.objectId;
  const qc = useQueryClient();
  const queryKey = useMemo(() => ['custom-columns', 'object', objectId ?? ''] as const, [objectId]);
  const query = useQuery({ queryKey, queryFn: () => fetchCustomColumnsWithValues(objectId!), enabled: !!objectId });
  const customColumns = useMemo(() => (query.data ?? []).filter((c) => c.object_id === objectId), [query.data, objectId]);
  const [editor, setEditor] = useState<{ objectId: string; column?: CustomColumnWithValues } | null>(null);
  const [failure, setFailure] = useState<{ objectId: string; retry: () => Promise<void> } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const writes = useRef(new Map<string, Promise<void>>());
  const refetch = useCallback(async () => { await qc.invalidateQueries({ queryKey }); }, [qc, queryKey]);
  const refresh = async () => { await Promise.all([qc.invalidateQueries({ queryKey: ['custom-columns'] }), qc.invalidateQueries({ queryKey: ['element'] })]); };
  const save = async (draft: FieldDraft) => {
    if (!objectId) throw new Error('No Object selected');
    if (editor?.column) await updateCustomColumn(editor.column.id, { name: draft.name, options: draft.options });
    else {
      const created = await createCustomColumn({ object_id: objectId, name: draft.name, column_type: draft.type, options: draft.options });
      revealCustomColumn(options.colStorageKey, created.id);
    }
    await refresh();
  };
  const onColumnValueChange = useCallback(async (columnId: string, elementId: string, value: Json) => {
    const key = `${columnId}:${elementId}`;
    const write = async () => { await setCustomColumnValue(columnId, elementId, value); await refetch(); };
    const previous = writes.current.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(write);
    writes.current.set(key, next);
    try { await next; if (writes.current.get(key) === next) setFailure(null); }
    catch (error) {
      // A refusal (outside the boundary) cannot succeed on retry: say why
      // instead of offering Retry. The cell drops its optimistic value.
      if (isPropertyWriteRefused(error)) noticePropertyValueFailed(error);
      else if (objectId && writes.current.get(key) === next) setFailure({ objectId, retry: write });
      throw error;
    }
    finally { if (writes.current.get(key) === next) writes.current.delete(key); }
  }, [refetch, objectId]);
  return {
    customColumns, refetch, onColumnValueChange,
    openAddColumn: () => { if (objectId) setEditor({ objectId }); },
    openEditColumn: (column: CustomColumnWithValues) => { if (objectId && column.object_id === objectId) setEditor({ objectId, column }); },
    addColumnModal: <>
      {((failure && failure.objectId === objectId) || query.isError) && <div role="alert" className="fixed bottom-4 right-4 z-[100] rounded-lg bg-popover border border-border p-4 text-sm text-foreground flex items-center gap-3">
        {failure ? t('Field value was not saved.') : t('Fields could not be loaded.')}
        <Button type="button" variant="secondary" size="sm" disabled={retrying} onClick={async () => {
          setRetrying(true);
          try { if (failure) { await failure.retry(); setFailure(null); } else await refetch(); }
          catch { /* Keep the failure visible. */ }
          finally { setRetrying(false); }
        }}>{retrying ? t('Retrying…') : t('Retry')}</Button>
        {failure && <Button type="button" variant="ghost" size="sm" onClick={() => setFailure(null)}>{t('Dismiss')}</Button>}
      </div>}
      {editor && editor.objectId === objectId && <ObjectFieldDialog
        key={`${editor.objectId}:${editor.column?.id ?? 'new'}`} column={editor.column}
        onClose={() => setEditor(null)} onSave={save}
        onDelete={editor.column ? async () => { await deleteCustomColumn(editor.column!.id); await refresh(); } : undefined}
        onDuplicate={editor.column ? async () => {
          const column = editor.column!;
          const created = await createCustomColumn({ object_id: objectId!, name: t('{name} (copy)', { name: column.name }), column_type: column.column_type, options: column.options });
          revealCustomColumn(options.colStorageKey, created.id); await refresh();
        } : undefined}
      />}
    </>,
  };
}
export type CustomColumnsController = ReturnType<typeof useCustomColumns>;

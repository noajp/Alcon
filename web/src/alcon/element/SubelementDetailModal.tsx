'use client';

// SubelementDetailModal — used in two modes:
//   - create:  subelement === null → blank title input, "Create" submit
//   - detail:  subelement provided  → editable title, completion toggle,
//              "Save" + "Delete" buttons
//
// Subelements are a thin checklist row in the schema (title + is_completed
// + order_index), so the modal stays compact. We deliberately don't build
// a full ElementDetailView for them — the parent Element is where status /
// priority / assignee / comments live.

import { useEffect, useState } from 'react';
import { Check, Trash2, X, ArrowLeft } from 'lucide-react';
import {
  createSubelement,
  updateSubelement,
  deleteSubelement,
  toggleSubelementComplete,
} from '@/hooks/useSupabase';
import { AtomIcon } from '@/alcon/shared/AtomIcon';
import type { Subelement } from '@/types/database';

interface Props {
  /** When null, the modal is in "create" mode. */
  subelement: Subelement | null;
  /** Parent element — required for create + shown as breadcrumb. */
  parentElement: { id: string; title: string };
  onClose: () => void;
  onSaved?: () => void;
  onDeleted?: () => void;
}

export function SubelementDetailModal({
  subelement, parentElement, onClose, onSaved, onDeleted,
}: Props) {
  const isCreate = subelement === null;
  const [title, setTitle] = useState(subelement?.title ?? '');
  const [completed, setCompleted] = useState(!!subelement?.is_completed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Esc to close (without saving).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      if (isCreate) {
        await createSubelement({ element_id: parentElement.id, title: trimmed });
      } else {
        await updateSubelement(subelement!.id, {
          title: trimmed,
          is_completed: completed,
        });
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setError((e as Error).message || 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleCompletedInline = async () => {
    if (isCreate) {
      setCompleted((v) => !v);
      return;
    }
    setBusy(true);
    try {
      await toggleSubelementComplete(subelement!.id, !completed);
      setCompleted((v) => !v);
      onSaved?.();
    } catch (e) {
      setError((e as Error).message || 'Failed to toggle');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (isCreate || !subelement) return;
    if (!confirm('このサブイシューを削除します。よろしいですか?')) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSubelement(subelement.id);
      onDeleted?.();
      onClose();
    } catch (e) {
      setError((e as Error).message || 'Failed to delete');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Header — breadcrumb to parent + close */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0 text-[12px] text-muted-foreground">
            <ArrowLeft size={13} className="opacity-60" />
            <span className="truncate">{parentElement.title}</span>
            <span className="opacity-40">/</span>
            <span className="text-foreground font-medium truncate">
              {isCreate ? 'New sub-issue' : (subelement?.display_id || 'Sub-issue')}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
            title="Close (Esc)"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={handleToggleCompletedInline}
              disabled={busy}
              aria-label={completed ? 'Mark as todo' : 'Mark as done'}
              className={`mt-1.5 w-4 h-4 rounded-[2px] flex items-center justify-center shrink-0 transition-colors ${
                completed
                  ? 'bg-emerald-500 hover:bg-emerald-600'
                  : 'border border-muted-foreground/40 hover:border-foreground/60'
              }`}
            >
              {completed && <Check size={11} strokeWidth={3} className="text-white" />}
            </button>
            <AtomIcon className="size-3.5 mt-2 text-muted-foreground/70 shrink-0" />
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
              placeholder="Sub-issue title"
              autoFocus
              className={`flex-1 text-[16px] font-medium bg-transparent border-none focus:outline-none ${
                completed ? 'line-through text-muted-foreground' : 'text-foreground'
              }`}
            />
          </div>

          {error && <div className="text-[12px] text-red-500">{error}</div>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border bg-muted/20">
          <div>
            {!isCreate && (
              <button
                onClick={handleDelete}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-red-600 hover:bg-red-500/10 rounded transition-colors disabled:opacity-40"
              >
                <Trash2 size={12} /> Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!title.trim() || busy}
              className="px-3 py-1.5 text-[12px] font-medium text-white bg-foreground hover:opacity-90 rounded transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isCreate ? 'Create' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

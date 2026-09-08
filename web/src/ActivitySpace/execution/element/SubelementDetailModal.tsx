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

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Trash2, X } from 'lucide-react';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import {
  createSubelement,
  updateSubelement,
  deleteSubelement,
  toggleSubelementComplete,
} from '@/hooks/useSupabase';
import { ElementIcon } from '@/Function/shared/conceptIcons';
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
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus the title on open (rAF so it lands after mount/paint).
  useEffect(() => {
    const id = requestAnimationFrame(() => taRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // Auto-grow the title textarea up to a max height (mirrors QuickAdd).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [title]);

  // Esc to close (without saving) — one level: the modal, not the Element
  // page under it.
  useEscapeLayer(true, onClose);

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
    if (!confirm('このサブエレメントを削除します。よろしいですか?')) return;
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
    // Bottom-center floating popup — same chrome as QuickAddElementPopup so
    // creating a sub-element feels like creating an Element (rounded-2xl
    // popover, chip header, ArrowUp submit). No dark backdrop; Esc / X close.
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none">
      <div
        className="pointer-events-auto w-full max-w-[560px] rounded-2xl bg-popover/95 backdrop-blur-md border border-border/60 p-4"
        role="dialog"
        aria-label={isCreate ? 'New sub-element' : 'Sub-element'}
      >
        {/* Header — parent context chip + close */}
        <div className="flex items-center gap-2 px-1 mb-2">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted/40 text-[12px] text-muted-foreground">
            <ElementIcon size={12} />
            <span className="truncate max-w-[220px]">{parentElement.title}</span>
          </span>
          <span className="text-[11px] text-muted-foreground">
            {isCreate ? 'New sub-element' : (subelement?.display_id || 'Sub-element')}
          </span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Title — auto-grow textarea. The completion checkbox only makes
            sense when editing an existing sub-element; in create mode there's
            nothing to mark done yet, so it's hidden. */}
        <div className="flex items-start gap-2">
          {!isCreate && (
            <button
              type="button"
              onClick={handleToggleCompletedInline}
              disabled={busy}
              aria-label={completed ? 'Mark as todo' : 'Mark as done'}
              className={`mt-2 w-4 h-4 rounded-[3px] flex items-center justify-center shrink-0 transition-colors ${
                completed
                  ? 'bg-emerald-500 hover:bg-emerald-600'
                  : 'border border-muted-foreground/40 hover:border-foreground/60'
              }`}
            >
              {completed && <Check size={11} strokeWidth={3} className="text-white" />}
            </button>
          )}
          <textarea
            ref={taRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Sub-element title… (Enter to save)"
            rows={1}
            className={`flex-1 bg-transparent px-1 py-1 text-[15px] font-medium placeholder:text-muted-foreground/60 resize-none ${
              completed ? 'line-through text-muted-foreground' : 'text-foreground'
            }`}
          />
        </div>

        {error && <div className="px-1 pt-2 text-[12px] text-red-500">{error}</div>}

        {/* Footer — delete (detail only) + submit */}
        <div className="flex items-center justify-between gap-2 px-1 pt-3">
          <div className="min-w-0">
            {!isCreate && (
              <button
                onClick={handleDelete}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-colors disabled:opacity-40"
              >
                <Trash2 size={12} /> Delete
              </button>
            )}
          </div>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowUp size={13} />
            {isCreate ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

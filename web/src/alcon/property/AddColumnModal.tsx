'use client';

import type { CustomColumnType } from '@/types/database';
import { AddPropertyMenu } from './AddPropertyButton';

interface AddColumnModalProps {
  onClose: () => void;
  onAdd: (name: string, type: CustomColumnType) => void;
  /** Which level this property menu is for. Object (Project-level) and
   *  Element (Task-level) offer different palettes. Defaults to 'element'. */
  scope?: 'object' | 'element';
  /** Bounding rect of the "+" that opened this, so the panel anchors right
   *  beside it (like the detail rail's popover). Falls back to centred when
   *  omitted (callers that open it without a trigger element). */
  anchor?: DOMRect | null;
  deletedBuiltInColumns?: { id: string; name: string; builtinType: 'assignees' | 'priority' | 'status' | 'due_date' }[];
  onRestoreBuiltIn?: (builtinType: 'assignees' | 'priority' | 'status' | 'due_date') => void;
}

const PANEL_WIDTH = 256; // w-64

// List-view "add property" picker. Shares its body (AddPropertyMenu) with the
// detail rail's AddPropertyButton popover so both surfaces read as the same
// control. A transparent full-screen layer catches outside-clicks; the panel
// itself anchors beside the "+" when an anchor rect is provided.
export function AddColumnModal({
  onClose,
  onAdd,
  scope = 'element',
  anchor,
  deletedBuiltInColumns,
  onRestoreBuiltIn,
}: AddColumnModalProps) {
  // Anchored: drop just below the "+", right edges aligned, clamped to the
  // viewport. Otherwise centre near the top.
  const style: React.CSSProperties = anchor
    ? {
        position: 'fixed',
        top: anchor.bottom + 6,
        left: Math.max(8, Math.min(anchor.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 8)),
      }
    : { position: 'fixed', top: '18vh', left: '50%', transform: 'translateX(-50%)' };

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div
        className="w-64 rounded-md border border-border bg-popover shadow-md p-1.5"
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <AddPropertyMenu
          scope={scope}
          onAdd={onAdd}
          onClose={onClose}
          deletedBuiltInColumns={deletedBuiltInColumns}
          onRestoreBuiltIn={onRestoreBuiltIn}
        />
      </div>
    </div>
  );
}

'use client';

// Craft section rendered inside ElementDetailView. Shows a button to
// launch the workspace and a list of finalized crafts (checked-out
// deliverables). Each finalized craft can be re-opened in a sandboxed
// iframe preview, downloaded, or deleted.

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Plus, Eye, Download, Trash2, ExternalLink } from 'lucide-react';
import { CraftWorkspace } from './CraftWorkspace';
import { loadFinalized, appendFinalized, removeFinalized } from './craftStore';
import type { Craft } from './types';

interface Props {
  element: { id: string; title: string; description?: string | null };
  /** Called after a successful checkout so the parent can update status etc. */
  onCheckedOut?: (craft: Craft) => void;
}

export function CraftSection({ element, onCheckedOut }: Props) {
  const [open, setOpen] = useState(false);
  const [crafts, setCrafts] = useState<Craft[]>([]);
  const [previewing, setPreviewing] = useState<Craft | null>(null);

  useEffect(() => {
    setCrafts(loadFinalized(element.id));
  }, [element.id]);

  const handleCheckOut = (craft: Craft) => {
    const next = appendFinalized(craft);
    setCrafts(next);
    onCheckedOut?.(craft);
  };

  const handleDelete = (craftId: string) => {
    if (!confirm('この craft を削除します。よろしいですか?')) return;
    setCrafts(removeFinalized(element.id, craftId));
  };

  const handleDownload = (craft: Craft) => {
    const blob = new Blob([craft.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${craft.title.replace(/[^a-zA-Z0-9._-]/g, '_')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="rounded-xl bg-muted/30 p-3">
        <div className="flex items-center justify-between px-1 pb-2">
          <div className="flex items-center gap-1.5">
            <Sparkles size={11} className="text-amber-500" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Crafts</span>
            {crafts.length > 0 && (
              <span className="text-[10.5px] text-muted-foreground/70">· {crafts.length}</span>
            )}
          </div>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1 px-2 py-0.5 text-[12px] text-foreground bg-amber-500/10 hover:bg-amber-500/20 rounded transition-colors"
            title="Open the craft workspace"
          >
            <Plus size={12} /> Craft
          </button>
        </div>

        {crafts.length === 0 ? (
          <button
            onClick={() => setOpen(true)}
            className="w-full text-left text-[13px] text-muted-foreground hover:text-foreground px-1 py-1"
          >
            + Generate a deliverable (slides, LP, …)
          </button>
        ) : (
          <div className="space-y-1">
            {crafts.map((craft) => (
              <CraftRow
                key={craft.id}
                craft={craft}
                onPreview={() => setPreviewing(craft)}
                onDownload={() => handleDownload(craft)}
                onDelete={() => handleDelete(craft.id)}
              />
            ))}
          </div>
        )}
      </div>

      {open && (
        <CraftWorkspace
          element={element}
          onClose={() => setOpen(false)}
          onCheckOut={handleCheckOut}
        />
      )}

      {previewing && (
        <CraftPreviewModal craft={previewing} onClose={() => setPreviewing(null)} />
      )}
    </>
  );
}

function CraftRow({
  craft, onPreview, onDownload, onDelete,
}: {
  craft: Craft;
  onPreview: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const created = useMemo(() => {
    try {
      return new Date(craft.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }, [craft.created_at]);
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 bg-muted/30 rounded-md group">
      <Sparkles size={12} className="text-amber-500 flex-shrink-0" />
      <button
        onClick={onPreview}
        className="text-[13px] text-foreground hover:underline truncate flex-1 text-left"
        title={craft.title}
      >
        {craft.title}
      </button>
      <span className="text-[10.5px] text-muted-foreground/70 shrink-0">{craft.format} · {created}</span>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
        <button onClick={onPreview} className="p-1 text-muted-foreground hover:text-foreground" title="Preview">
          <Eye size={12} />
        </button>
        <button onClick={onDownload} className="p-1 text-muted-foreground hover:text-foreground" title="Download HTML">
          <Download size={12} />
        </button>
        <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive" title="Delete">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function CraftPreviewModal({ craft, onClose }: { craft: Craft; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  const src = `data:text/html;charset=utf-8,${encodeURIComponent(craft.html)}`;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={14} className="text-amber-500 shrink-0" />
          <span className="text-[13px] font-medium truncate">{craft.title}</span>
          <span className="text-[11px] text-muted-foreground shrink-0">· {craft.format}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
          >
            <ExternalLink size={12} /> Open
          </a>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] text-foreground hover:bg-muted rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-6 flex items-start justify-center bg-muted/10">
        <iframe
          src={src}
          sandbox=""
          title={craft.title}
          className="w-full max-w-[1200px] aspect-[16/9] bg-white rounded-md shadow-lg border border-border"
        />
      </div>
    </div>
  );
}

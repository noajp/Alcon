'use client';

// Craft section rendered inside ElementDetailView. Surfaces both
// Documentation and Presentation as primary actions (with their respective
// brand colors) and lists finalized crafts. Each row carries a colored
// band so the format is identifiable at a glance.

import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Eye, Download, Trash2, ExternalLink, FileText, Presentation,
} from 'lucide-react';
import { CraftWorkspace } from './CraftWorkspace';
import { loadFinalized, appendFinalized, removeFinalized } from './craftStore';
import type { Craft, CraftFormat } from './types';

interface Props {
  element: { id: string; title: string; description?: string | null };
  /** Called after a successful checkout so the parent can update status etc. */
  onCheckedOut?: (craft: Craft) => void;
}

const FORMAT_THEME: Record<CraftFormat, {
  label: string;
  icon: typeof FileText;
  band: string;       // for the row's left band + finalized preview header
  cta: string;        // for the launch button
}> = {
  documentation: {
    label: 'Documentation',
    icon: FileText,
    band: 'bg-gradient-to-r from-[#0F2A52] to-[#1B4FA7]',
    cta: 'bg-[#1B4FA7] hover:bg-[#163E8A] text-white',
  },
  presentation: {
    label: 'Presentation',
    icon: Presentation,
    band: 'bg-gradient-to-r from-[#B7410E] to-[#E2722C]',
    cta: 'bg-[#B7410E] hover:bg-[#94340A] text-white',
  },
};

export function CraftSection({ element, onCheckedOut }: Props) {
  const [openFormat, setOpenFormat] = useState<CraftFormat | null>(null);
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
          <div className="flex items-center gap-1.5">
            <LaunchButton format="documentation" onClick={() => setOpenFormat('documentation')} />
            <LaunchButton format="presentation" onClick={() => setOpenFormat('presentation')} />
          </div>
        </div>

        {crafts.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground px-1 py-1">
            上のボタンで Documentation (1 ページ ドキュメント) か Presentation (スライド) のどちらかを起動。AI が初稿を作り、人間がそのまま編集できます。
          </p>
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

      {openFormat && (
        <CraftWorkspace
          element={element}
          initialFormat={openFormat}
          onClose={() => setOpenFormat(null)}
          onCheckOut={handleCheckOut}
        />
      )}

      {previewing && (
        <CraftPreviewModal craft={previewing} onClose={() => setPreviewing(null)} />
      )}
    </>
  );
}

function LaunchButton({ format, onClick }: { format: CraftFormat; onClick: () => void }) {
  const theme = FORMAT_THEME[format];
  const Icon = theme.icon;
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded transition-colors ${theme.cta}`}
      title={`Open ${theme.label} workspace`}
    >
      <Icon size={12} /> {theme.label}
    </button>
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
  const theme = FORMAT_THEME[craft.format];
  const Icon = theme.icon;
  const created = useMemo(() => {
    try {
      return new Date(craft.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }, [craft.created_at]);
  return (
    <div className="flex items-stretch bg-muted/30 rounded-md group overflow-hidden">
      <div className={`w-1 ${theme.band}`} />
      <div className="flex items-center gap-2 py-1.5 pl-2 pr-2 flex-1 min-w-0">
        <Icon size={12} className="text-muted-foreground flex-shrink-0" />
        <button
          onClick={onPreview}
          className="text-[13px] text-foreground hover:underline truncate flex-1 text-left"
          title={craft.title}
        >
          {craft.title}
        </button>
        <span className="text-[10.5px] text-muted-foreground/70 shrink-0">{theme.label} · {created}</span>
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
    </div>
  );
}

function CraftPreviewModal({ craft, onClose }: { craft: Craft; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  const theme = FORMAT_THEME[craft.format];
  const Icon = theme.icon;
  const src = `data:text/html;charset=utf-8,${encodeURIComponent(craft.html)}`;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm">
      <div className={`h-2.5 ${theme.band}`} />
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={14} className="text-muted-foreground shrink-0" />
          <span className="text-[13px] font-medium truncate">{craft.title}</span>
          <span className="text-[11px] text-muted-foreground shrink-0">· {theme.label}</span>
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
          className={`w-full max-w-[1200px] bg-white rounded-md shadow-lg border border-border ${
            craft.format === 'presentation' ? 'aspect-[16/9]' : 'min-h-[80vh]'
          }`}
        />
      </div>
    </div>
  );
}

'use client';

// Compact entry point to the Crafting feature. A single neutral pill —
// "Craft" — opens the studio modal; the user picks Document vs Slides
// on the studio's top tabs. Finalized crafts hang as a small one-line
// list underneath; this is intentionally minimal so it slots into the
// existing ElementDetail action row without dominating it.

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { FileText, Presentation, ExternalLink, Trash2 } from 'lucide-react';
import { CraftIcon } from './CraftIcon';
// CraftStudio is a ~2k-line editor pulled in only when the user opens it,
// so it loads on demand instead of riding in the main bundle.
const CraftStudio = dynamic(() => import('./CraftStudio').then((m) => m.CraftStudio), { ssr: false });
import { loadFinalized, appendFinalized, removeFinalized } from './craftStore';
import type { Craft, CraftFormat } from './types';
import { formatElementDate } from '@/alcon/shared/dateUtils';

interface Props {
  element: { id: string; title: string; description?: string | null };
  onCheckedOut?: (craft: Craft) => void;
}

const FORMAT_THEME: Record<CraftFormat, {
  label: string;
  short: string;
  icon: typeof FileText;
  accent: string;
}> = {
  documentation: {
    label: 'Documentation',
    short: 'Doc',
    icon: FileText,
    accent: 'text-blue-500',
  },
  presentation: {
    label: 'Presentation',
    short: 'Slide',
    icon: Presentation,
    accent: 'text-orange-500',
  },
};

export function CraftButton({ element, onCheckedOut }: Props) {
  const [open, setOpen] = useState<CraftFormat | null>(null);
  const [crafts, setCrafts] = useState<Craft[]>([]);
  const [previewing, setPreviewing] = useState<Craft | null>(null);

  useEffect(() => {
    setCrafts(loadFinalized(element.id));
  }, [element.id]);

  const handleCheckOut = (craft: Craft) => {
    setCrafts(appendFinalized(craft));
    onCheckedOut?.(craft);
  };

  const handleDelete = (craftId: string) => {
    if (!confirm('この craft を削除します。よろしいですか?')) return;
    setCrafts(removeFinalized(element.id, craftId));
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setOpen('documentation')}
          title="Open Crafting workspace"
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <CraftIcon size={15} />
        </button>
        {crafts.length > 0 && (
          <span className="text-[11px] text-zinc-500 ml-1">· {crafts.length}</span>
        )}
      </div>

      {crafts.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {crafts.map((c) => (
            <CraftRow
              key={c.id}
              craft={c}
              onPreview={() => setPreviewing(c)}
              onDelete={() => handleDelete(c.id)}
            />
          ))}
        </div>
      )}

      {open && (
        <CraftStudio
          element={element}
          initialFormat={open}
          onClose={() => setOpen(null)}
          onCheckOut={handleCheckOut}
        />
      )}

      {previewing && <CraftPreview craft={previewing} onClose={() => setPreviewing(null)} />}
    </>
  );
}

function CraftRow({
  craft, onPreview, onDelete,
}: {
  craft: Craft;
  onPreview: () => void;
  onDelete: () => void;
}) {
  const t = FORMAT_THEME[craft.format];
  const Icon = t.icon;
  const created = useMemo(() => formatElementDate(craft.created_at) ?? '', [craft.created_at]);
  return (
    <div className="flex items-stretch rounded-md group overflow-hidden hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
      <div className="flex items-center gap-2 py-1 pl-2 pr-1.5 flex-1 min-w-0">
        <Icon size={11} className={`${t.accent} flex-shrink-0`} />
        <button onClick={onPreview} className="text-[12px] text-zinc-700 dark:text-zinc-200 hover:underline truncate flex-1 text-left">
          {craft.title}
        </button>
        <span className="text-[10.5px] text-zinc-400 shrink-0">{t.short} · {created}</span>
        <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-red-500 transition-opacity" title="Delete">
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

function CraftPreview({ craft, onClose }: { craft: Craft; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  const t = FORMAT_THEME[craft.format];
  const Icon = t.icon;
  const src = `data:text/html;charset=utf-8,${encodeURIComponent(craft.html)}`;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full h-full max-w-[1400px] max-h-[900px] bg-white dark:bg-zinc-950 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 min-w-0">
            <Icon size={13} className={t.accent} />
            <span className="text-[13px] font-medium truncate">{craft.title}</span>
            <span className="text-[11px] text-zinc-400">· {t.label}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <a href={src} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors">
              <ExternalLink size={12} /> Open
            </a>
            <button onClick={onClose} className="px-3 py-1.5 text-[12px] hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors">
              Close
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6 flex items-start justify-center bg-zinc-50 dark:bg-zinc-900">
          <iframe
            src={src}
            sandbox=""
            title={craft.title}
            className={`w-full max-w-[1200px] bg-white rounded-md shadow-lg border border-zinc-200 ${
              craft.format === 'presentation' ? 'aspect-[16/9]' : 'min-h-[80vh]'
            }`}
          />
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';

interface ReportPreviewProps {
  signedUrl: string;
  filename: string;
}

// Word-style preview wrapping a faithful docx-preview render. Unlike mammoth,
// docx-preview reads the document's style table (Title/Subtitle/Heading colors,
// table accents, page setup) so the inline preview matches what Word/Google Docs
// shows when opening the same file. The original docx is still downloadable.
export function ReportPreview({ signedUrl, filename }: ReportPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(signedUrl);
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        const buf = await res.arrayBuffer();
        const { renderAsync } = await import('docx-preview');
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = '';
        await renderAsync(buf, containerRef.current, undefined, {
          className: 'docx',
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
          experimental: true,
          useBase64URL: true,
        });
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [signedUrl]);

  return (
    <div className="rounded-lg overflow-hidden border border-border bg-card">
      {/* Word-style title bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
        <div className="w-5 h-5 rounded-sm bg-[#2B579A] flex items-center justify-center text-white shrink-0">
          <FileText size={11} strokeWidth={2.2} />
        </div>
        <span className="text-[12px] font-medium text-foreground truncate flex-1">
          {filename}
        </span>
        <span className="hidden md:inline text-[10px] text-muted-foreground">
          読み取り専用
        </span>
        <a
          href={signedUrl}
          download={filename}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded hover:bg-muted transition-colors"
          title="docx をダウンロード"
        >
          <Download size={11} />
          Download
        </a>
      </div>

      {/* Canvas — docx-preview generates its own A4 pages with shadows */}
      <div
        className={[
          'bg-neutral-300/40 dark:bg-neutral-900 max-h-[720px] overflow-auto px-6 py-8 relative',
          // Style hooks for docx-preview output (it sets className="docx", wrapper "docx-wrapper")
          '[&_.docx-wrapper]:flex [&_.docx-wrapper]:flex-col [&_.docx-wrapper]:items-center [&_.docx-wrapper]:gap-4 [&_.docx-wrapper]:bg-transparent',
          '[&_section.docx]:bg-white [&_section.docx]:shadow-[0_1px_3px_rgba(0,0,0,0.10),0_8px_24px_-4px_rgba(0,0,0,0.18)] [&_section.docx]:rounded-sm',
        ].join(' ')}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[13px] gap-2 bg-neutral-300/40 dark:bg-neutral-900 z-10">
            <Loader2 size={14} className="animate-spin" />
            プレビューを生成中…
          </div>
        )}
        {error && (
          <div className="mx-auto max-w-[816px] bg-white text-destructive text-[13px] p-8 rounded-sm shadow-sm">
            プレビューの読み込みに失敗しました: {error}
          </div>
        )}
        <div ref={containerRef} className="docx-host" />
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 px-3 py-1 bg-muted/30 border-t border-border text-[10px] text-muted-foreground">
        <span>ドキュメント</span>
        <span className="ml-auto tabular-nums">100%</span>
      </div>
    </div>
  );
}

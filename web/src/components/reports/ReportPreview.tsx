'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';

interface ReportPreviewProps {
  signedUrl: string;
  filename: string;
}

// Renders a docx as if it were opened inside Word: a thin title bar, a gray
// canvas, a white A4-ish "sheet" with paper shadow and 1-inch margins, and a
// minimal status bar. The HTML body comes from mammoth.js client-side.
export function ReportPreview({ signedUrl, filename }: ReportPreviewProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setHtml(null);
        setError(null);
        const res = await fetch(signedUrl);
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        const buf = await res.arrayBuffer();
        const mammoth = await import('mammoth');
        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
        if (!cancelled) setHtml(result.value);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? e));
      }
    })();
    return () => { cancelled = true; };
  }, [signedUrl]);

  return (
    <div className="rounded-lg overflow-hidden border border-border bg-card">
      {/* Title bar — Word-style */}
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

      {/* Canvas */}
      <div className="bg-neutral-300/40 dark:bg-neutral-900 max-h-[720px] overflow-auto px-6 py-8">
        {error ? (
          <div className="mx-auto max-w-[816px] bg-white text-destructive text-[13px] p-8 rounded-sm shadow-sm">
            プレビューの読み込みに失敗しました: {error}
          </div>
        ) : html === null ? (
          <div className="mx-auto bg-white text-muted-foreground rounded-sm shadow-[0_1px_3px_rgba(0,0,0,0.10),0_8px_24px_-4px_rgba(0,0,0,0.16)] flex items-center justify-center gap-2 text-[13px]" style={{ width: 'min(100%, 816px)', minHeight: 540 }}>
            <Loader2 size={14} className="animate-spin" />
            プレビューを生成中…
          </div>
        ) : (
          <div
            className="docx-page mx-auto bg-white text-neutral-900 rounded-sm shadow-[0_1px_3px_rgba(0,0,0,0.10),0_8px_24px_-4px_rgba(0,0,0,0.16)] [&_h1]:text-[20pt] [&_h1]:font-semibold [&_h1]:mt-0 [&_h1]:mb-3 [&_h2]:text-[14pt] [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-[12pt] [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_p]:my-2 [&_p]:leading-[1.6] [&_ul]:my-2 [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:pl-6 [&_li]:my-0.5 [&_table]:my-3 [&_table]:border-collapse [&_table]:w-full [&_th]:border [&_th]:border-neutral-300 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-neutral-100 [&_th]:text-left [&_td]:border [&_td]:border-neutral-300 [&_td]:px-2 [&_td]:py-1 [&_a]:text-[#2B579A] [&_a]:underline"
            style={{
              width: 'min(100%, 816px)',
              minHeight: 1056, // ~ US Letter / A4 hybrid at 96dpi
              padding: '96px 96px', // 1 inch margins
              fontFamily:
                '"Calibri", "Yu Gothic UI", "Yu Gothic", "游ゴシック", "Hiragino Sans", "Meiryo", system-ui, sans-serif',
              fontSize: '11pt',
              lineHeight: 1.55,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 px-3 py-1 bg-muted/30 border-t border-border text-[10px] text-muted-foreground">
        <span>ページ 1</span>
        <span className="ml-auto tabular-nums">100%</span>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';

interface ReportPreviewProps {
  signedUrl: string;
  filename: string;
}

// Renders an in-browser HTML preview of a .docx by streaming the file through
// mammoth.js. The original docx remains downloadable via the Download button.
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
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
        <FileText size={14} className="text-muted-foreground" />
        <span className="text-[13px] font-medium text-foreground truncate flex-1">{filename}</span>
        <a
          href={signedUrl}
          download={filename}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md hover:bg-muted transition-colors"
        >
          <Download size={12} />
          Download
        </a>
      </div>
      <div className="max-h-[600px] overflow-auto px-6 py-5">
        {error ? (
          <div className="text-[13px] text-destructive">プレビューの読み込みに失敗しました: {error}</div>
        ) : html === null ? (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            プレビューを生成中…
          </div>
        ) : (
          <div
            className="prose prose-sm max-w-none [&_table]:text-[13px] [&_h1]:text-[18px] [&_h2]:text-[15px] [&_h3]:text-[14px] [&_p]:text-[13px] [&_ul]:text-[13px] [&_ol]:text-[13px]"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}

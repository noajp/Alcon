'use client';

import { File, FileArchive, FileAudio, FileImage, FileText, FileVideo } from '@/ui/icons';

// An attached file's kind, said by its icon, so its row needs only the title.
// PDF, Word, Excel, PowerPoint, HTML and Markdown show their own marks (from
// svgl.app, kept in public/file-types, as the integration logos are; a mark
// drawn for one theme has its other-theme version beside it); everything
// else a line icon of its kind.

const LOGOS: { exts: string[]; mime?: string; src: string; dark?: string }[] = [
  { exts: ['pdf'], mime: 'application/pdf', src: '/file-types/pdf.svg' },
  { exts: ['doc', 'docx', 'rtf', 'odt'], src: '/file-types/word.svg' },
  { exts: ['xls', 'xlsx', 'csv', 'ods'], src: '/file-types/excel.svg' },
  { exts: ['ppt', 'pptx', 'odp'], src: '/file-types/powerpoint.svg' },
  { exts: ['html', 'htm'], mime: 'text/html', src: '/file-types/html.svg' },
  { exts: ['md', 'markdown', 'mdx'], mime: 'text/markdown', src: '/file-types/markdown.svg', dark: '/file-types/markdown-dark.svg' },
];

export function FileTypeIcon({ name, mime, size = 15 }: { name: string; mime: string | null; size?: number }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const m = mime ?? '';
  const logo = LOGOS.find((l) => l.exts.includes(ext) || (l.mime && l.mime === m));
  if (logo) {
    const img = (src: string, className = '') => (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" width={size} height={size} className={`shrink-0 object-contain ${className}`} />
    );
    return logo.dark ? <>{img(logo.src, 'dark:hidden')}{img(logo.dark, 'hidden dark:block')}</> : img(logo.src);
  }
  if (m.startsWith('image/')) return <FileImage size={size} className="shrink-0 text-muted-foreground" />;
  if (m.startsWith('video/')) return <FileVideo size={size} className="shrink-0 text-muted-foreground" />;
  if (m.startsWith('audio/')) return <FileAudio size={size} className="shrink-0 text-muted-foreground" />;
  if (['zip', 'gz', 'tar', '7z', 'rar'].includes(ext)) return <FileArchive size={size} className="shrink-0 text-muted-foreground" />;
  if (m.startsWith('text/') || ['txt', 'json', 'log', 'yaml', 'yml'].includes(ext)) return <FileText size={size} className="shrink-0 text-muted-foreground" />;
  return <File size={size} className="shrink-0 text-muted-foreground" />;
}

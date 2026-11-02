'use client';

import { File, FileArchive, FileAudio, FileImage, FileText, FileVideo } from '@/ui/icons';

// An attached file's kind, said by its icon, so its row needs only the title.
// PDF, Word, Excel and PowerPoint show their own marks (from svgl.app, kept in
// public/file-types, as the integration logos are); everything else a line
// icon of its kind.

const LOGOS: { exts: string[]; mime?: string; src: string }[] = [
  { exts: ['pdf'], mime: 'application/pdf', src: '/file-types/pdf.svg' },
  { exts: ['doc', 'docx', 'rtf', 'odt'], src: '/file-types/word.svg' },
  { exts: ['xls', 'xlsx', 'csv', 'ods'], src: '/file-types/excel.svg' },
  { exts: ['ppt', 'pptx', 'odp'], src: '/file-types/powerpoint.svg' },
  { exts: ['html', 'htm'], mime: 'text/html', src: '/file-types/html.svg' },
];

export function FileTypeIcon({ name, mime, size = 15 }: { name: string; mime: string | null; size?: number }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const m = mime ?? '';
  const logo = LOGOS.find((l) => l.exts.includes(ext) || (l.mime && l.mime === m));
  // eslint-disable-next-line @next/next/no-img-element
  if (logo) return <img src={logo.src} alt="" width={size} height={size} className="shrink-0 object-contain" />;
  if (m.startsWith('image/')) return <FileImage size={size} className="shrink-0 text-muted-foreground" />;
  if (m.startsWith('video/')) return <FileVideo size={size} className="shrink-0 text-muted-foreground" />;
  if (m.startsWith('audio/')) return <FileAudio size={size} className="shrink-0 text-muted-foreground" />;
  if (['zip', 'gz', 'tar', '7z', 'rar'].includes(ext)) return <FileArchive size={size} className="shrink-0 text-muted-foreground" />;
  if (m.startsWith('text/') || ['md', 'txt', 'json', 'log', 'yaml', 'yml'].includes(ext)) return <FileText size={size} className="shrink-0 text-muted-foreground" />;
  return <File size={size} className="shrink-0 text-muted-foreground" />;
}

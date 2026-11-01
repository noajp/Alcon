'use client';

import { FilePreview, type FileSource } from '@/Function/office/FilePreview';
import { downloadElementFile, elementFileUrl, openElementFile, type ElementFile } from '@/hooks/elementFileData';

// An Element's attached file, previewed under its row: the shared preview,
// reading from the Element's private bucket.
const ELEMENT_FILES: FileSource = {
  signedUrl: (f) => elementFileUrl(f as ElementFile),
  download: (f) => downloadElementFile(f as ElementFile),
  open: (f) => openElementFile(f as ElementFile),
};

export function ElementFilePreview({ file }: { file: ElementFile }) {
  return <FilePreview file={file} source={ELEMENT_FILES} />;
}

'use client';

import { FilePreview } from '@/Function/office/FilePreview';
import { elementFileSource, type ElementFile } from '@/hooks/elementFileData';

// An Element's attached file, previewed under its row: the shared preview,
// reading from the Element's private bucket.
export function ElementFilePreview({ file }: { file: ElementFile }) {
  return <FilePreview file={file} source={elementFileSource} />;
}

'use client';

import { FilePreview } from '@/Function/office/FilePreview';
import { elementFileSource, type ElementFile } from '@/hooks/elementFileData';
import { FileImportActions, canImport } from './FileImportActions';

// An Element's attached file, previewed under its row: the shared preview,
// reading from the Element's private bucket, with what the file can
// become in Alcon (FileImportActions).
export function ElementFilePreview({ file }: { file: ElementFile }) {
  return <FilePreview file={file} source={elementFileSource} actions={canImport(file.name) ? <FileImportActions file={file} /> : undefined} />;
}

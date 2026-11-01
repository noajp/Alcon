'use client';

import { useMemo } from 'react';
import { FilePreview, type FileEditor } from '@/Function/office/FilePreview';
import { elementFileSource, useElementFileActions, type ElementFile } from '@/hooks/elementFileData';
import { FileImportActions, canImport } from './FileImportActions';

// An Element's attached file, previewed under its row: the shared preview,
// reading from the Element's private bucket, with what the file can
// become in Alcon (FileImportActions). Edits made in the preview are saved
// as the file's next version.
export function ElementFilePreview({ file }: { file: ElementFile }) {
  const { saveEdits } = useElementFileActions(file.element_id);
  const editor = useMemo<FileEditor>(() => ({ save: (edits) => saveEdits.mutateAsync({ file, edits }) }), [file, saveEdits]);
  return <FilePreview file={file} source={elementFileSource} editor={editor}
    actions={canImport(file.name) ? <FileImportActions file={file} /> : undefined} />;
}

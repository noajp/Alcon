// Hands the viewer a file made in the browser (an export) to save.

/** Saves `bytes` as `name`; characters a file system refuses become "_". */
export function downloadBytes(bytes: Uint8Array, name: string, mime: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'export';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

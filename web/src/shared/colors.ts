// ============================================
// Folder Color Palette
// Used across Sidebar, Folder, File, and Elements components
// ============================================
export const folderColorPalette = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
];

export function getFolderColor(index: number): string {
  return folderColorPalette[index % folderColorPalette.length];
}

export function getFolderColorWithAlpha(index: number, alpha: string = '15'): string {
  return `${getFolderColor(index)}${alpha}`;
}

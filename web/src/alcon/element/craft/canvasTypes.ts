// Canvas data model for Crafting (Figma-lite).
// Each page has absolute-positioned items rendered on a fixed pixel
// stage. Pages match a real-world print/screen size so what the user
// sees on the dotted canvas equals what gets exported.

import type { CraftFormat } from './types';

export type CanvasItemType = 'text' | 'rect' | 'ellipse' | 'image';

export interface CanvasItemBase {
  id: string;
  type: CanvasItemType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}

export interface TextItem extends CanvasItemBase {
  type: 'text';
  text: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  fontFamily?: string;
}

export interface RectItem extends CanvasItemBase {
  type: 'rect';
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
}

export interface EllipseItem extends CanvasItemBase {
  type: 'ellipse';
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface ImageItem extends CanvasItemBase {
  type: 'image';
  src: string;
  fit: 'cover' | 'contain';
}

export type CanvasItem = TextItem | RectItem | EllipseItem | ImageItem;

export interface CraftPage {
  id: string;
  width: number;
  height: number;
  background: string;
  items: CanvasItem[];
}

export interface CraftDoc {
  format: CraftFormat;
  pages: CraftPage[];
}

// ---------- factory helpers ----------

export const PAGE_SIZE: Record<CraftFormat, { width: number; height: number; label: string }> = {
  documentation: { width: 794, height: 1123, label: 'A4 portrait' },   // 96 dpi A4
  presentation:  { width: 1600, height: 900, label: '16:9 slide' },
};

export function makePage(format: CraftFormat): CraftPage {
  const size = PAGE_SIZE[format];
  return {
    id: newId('p'),
    width: size.width,
    height: size.height,
    background: '#ffffff',
    items: [],
  };
}

export function emptyDoc(format: CraftFormat): CraftDoc {
  return { format, pages: [makePage(format)] };
}

export function makeText(x: number, y: number, format: CraftFormat): TextItem {
  return {
    id: newId('t'),
    type: 'text',
    x, y,
    w: format === 'presentation' ? 480 : 320,
    h: 56,
    text: 'テキストを入力',
    fontSize: format === 'presentation' ? 32 : 16,
    fontWeight: 400,
    color: '#111111',
    align: 'left',
  };
}

export function makeRect(x: number, y: number): RectItem {
  return {
    id: newId('r'),
    type: 'rect',
    x, y, w: 200, h: 120,
    fill: '#1B4FA7',
    stroke: 'transparent',
    strokeWidth: 0,
    radius: 8,
  };
}

export function makeEllipse(x: number, y: number): EllipseItem {
  return {
    id: newId('e'),
    type: 'ellipse',
    x, y, w: 160, h: 160,
    fill: '#E2722C',
    stroke: 'transparent',
    strokeWidth: 0,
  };
}

export function makeImage(x: number, y: number, src: string): ImageItem {
  return {
    id: newId('i'),
    type: 'image',
    x, y, w: 320, h: 200,
    src,
    fit: 'cover',
  };
}

// Multi-page helpers — Presentation mode lets the user stack pages on a
// thumbnail rail; Documentation stays single-page (callers can still add
// pages but the studio sidebar hides the rail).
export function addPageAfter(doc: CraftDoc, afterIndex: number): { doc: CraftDoc; newIndex: number } {
  const insertAt = Math.max(0, Math.min(afterIndex + 1, doc.pages.length));
  const page = makePage(doc.format);
  const pages = [...doc.pages.slice(0, insertAt), page, ...doc.pages.slice(insertAt)];
  return { doc: { ...doc, pages }, newIndex: insertAt };
}

export function removePageAt(doc: CraftDoc, index: number): { doc: CraftDoc; newIndex: number } {
  if (doc.pages.length <= 1) return { doc, newIndex: 0 };
  const pages = doc.pages.filter((_, i) => i !== index);
  return { doc: { ...doc, pages }, newIndex: Math.max(0, index - 1) };
}

export function duplicatePageAt(doc: CraftDoc, index: number): { doc: CraftDoc; newIndex: number } {
  const src = doc.pages[index];
  if (!src) return { doc, newIndex: 0 };
  const cloned: CraftPage = {
    ...src,
    id: newId('p'),
    items: src.items.map((it) => ({ ...it, id: newId(it.type[0]) } as CanvasItem)),
  };
  const pages = [...doc.pages.slice(0, index + 1), cloned, ...doc.pages.slice(index + 1)];
  return { doc: { ...doc, pages }, newIndex: index + 1 };
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

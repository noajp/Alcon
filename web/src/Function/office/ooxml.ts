import JSZip from 'jszip';

// What every Office reader here shares. An Office file is a zip of XML
// parts linked by relationship files; its elements are matched by local
// name, so a reader works whatever prefix a producer chose (p:, dsp:, a:,
// none). DrawingML colours — srgb, scheme, system, preset, with their
// luminance, tint, shade and alpha — resolve the same way in decks, charts
// and documents. Read with DOMParser: the browser, or jsdom in the tests.

const localOf = (name: string) => name.slice(name.indexOf(':') + 1);

/** Whether an element is the named one (prefix ignored). */
export const is = (el: Element | null | undefined, name: string) => !!el && el.localName === localOf(name);
/** An element's children with the name. */
export const kids = (el: Element | null | undefined, name: string): Element[] =>
  el ? Array.from(el.children).filter((c) => c.localName === localOf(name)) : [];
/** An element's first child with the name. */
export const kid = (el: Element | null | undefined, name: string): Element | null => kids(el, name)[0] ?? null;
/** Down a chain of child names. */
export const path = (el: Element | null | undefined, ...names: string[]): Element | null =>
  names.reduce<Element | null>((at, n) => kid(at, n), el ?? null);
/** Every descendant with the name. */
export const desc = (root: Element | Document | null | undefined, name: string): Element[] => {
  if (!root) return [];
  const local = localOf(name);
  return Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === local);
};
/** The first descendant with the name. */
export const first = (root: Element | Document | null | undefined, name: string): Element | null => desc(root, name)[0] ?? null;

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/** A relationship-id attribute (r:id, r:embed…), whatever its prefix. */
export const relId = (el: Element | null | undefined, name = 'id') => el?.getAttributeNS(R, name) ?? el?.getAttribute(`r:${name}`) ?? null;

/** EMU (DrawingML) and twips (WordprocessingML) to CSS pixels. */
export const emu = (v: string | number | null | undefined) => (v ? Number(v) / 9525 : 0);
export const twip = (v: string | number | null | undefined) => (v ? Number(v) / 15 : 0);

export interface Rel { target: string; type: string }
export interface Package {
  xml(path: string): Promise<Document | null>;
  rels(part: string): Promise<Map<string, Rel>>;
  /** A picture part as a data: URL (null for formats a browser cannot show). */
  dataUrl(path: string | null | undefined): Promise<string | null>;
  file(path: string): JSZip.JSZipObject | null;
}

/** The target of the first relationship of a kind (by type, else by path). */
export const relOfType = (rels: Map<string, Rel>, type: string) =>
  [...rels.values()].find((r) => r.type.endsWith(`/${type}`) || r.target.includes(`/${type}`))?.target ?? null;

/** Opens an Office file: parts parsed once and kept, relationships
 *  resolved to part paths. */
export async function openPackage(bytes: ArrayBuffer): Promise<Package> {
  const zip = await JSZip.loadAsync(bytes);
  const cache = new Map<string, Promise<Document | null>>();
  const xml = (p: string) => {
    if (!cache.has(p)) {
      const f = zip.file(p);
      cache.set(p, f ? f.async('string').then((s) => new DOMParser().parseFromString(s, 'application/xml')) : Promise.resolve(null));
    }
    return cache.get(p)!;
  };
  return {
    xml,
    file: (p) => zip.file(p),
    async rels(part) {
      const dir = part.slice(0, part.lastIndexOf('/'));
      const doc = await xml(`${dir}/_rels/${part.slice(dir.length + 1)}.rels`);
      const map = new Map<string, Rel>();
      for (const r of desc(doc, 'Relationship')) {
        const target = r.getAttribute('Target') ?? '';
        map.set(r.getAttribute('Id') ?? '', {
          target: target.startsWith('/') ? target.slice(1) : new URL(target, `http://x/${dir}/`).pathname.slice(1),
          type: r.getAttribute('Type') ?? '',
        });
      }
      return map;
    },
    async dataUrl(p) {
      const f = p ? zip.file(p) : null;
      const ext = p?.split('.').pop()?.toLowerCase();
      if (!f || !ext || ext === 'emf' || ext === 'wmf') return null;
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      return `data:${mime};base64,${await f.async('base64')}`;
    },
  };
}

// ── Themes ────────────────────────────────────────────────────────────────

/** Scheme colours in scheme order, for readers that index them. */
export const SCHEME_ORDER = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

/** A theme's colours by scheme name (dk1 → '000000'). */
export function themeColors(theme: Document | null): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const c of Array.from(first(theme, 'clrScheme')?.children ?? [])) {
    const v = c.children[0];
    colors[c.localName] = v?.getAttribute('val') ?? v?.getAttribute('lastClr') ?? '000000';
  }
  return colors;
}

/** A theme's heading and body fonts (East Asian face first, then Latin). */
export function themeFonts(theme: Document | null): { major: string | null; minor: string | null } {
  const face = (group: string, script?: 'latin' | 'ea') => {
    const g = first(theme, group);
    return script ? kid(g, script)?.getAttribute('typeface') || null
      : kid(g, 'ea')?.getAttribute('typeface') || kid(g, 'latin')?.getAttribute('typeface') || null;
  };
  return { major: face('majorFont'), minor: face('minorFont') };
}

// ── DrawingML colour ──────────────────────────────────────────────────────

const ALIAS: Record<string, string> = { tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2' };
const PRESET: Record<string, string> = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080' };
const COLOR_KINDS = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr'];

/** The colour inside an element (a fill, a run's properties, a gradient
 *  stop) as CSS, with its modifiers applied. `ph` is the colour a style
 *  reference supplies for "phClr". */
export function drawingColor(el: Element | null, colors: Record<string, string>, ph: string | null = null): string | null {
  const c = el ? Array.from(el.children).find((n) => COLOR_KINDS.includes(n.localName)) : null;
  if (!c) return null;
  const v = c.getAttribute('val') ?? '';
  const hex = c.localName === 'srgbClr' ? v
    : c.localName === 'sysClr' ? c.getAttribute('lastClr')
    : c.localName === 'schemeClr' ? (v === 'phClr' ? ph : colors[ALIAS[v] ?? v])
    : c.localName === 'prstClr' ? PRESET[v] ?? null : null;
  if (!hex) return null;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mod = (name: string) => { const m = kid(c, name)?.getAttribute('val'); return m ? Number(m) / 100000 : null; };
  const lumMod = mod('lumMod'), lumOff = mod('lumOff'), tint = mod('tint'), shade = mod('shade');
  if (lumMod != null || lumOff != null) [r, g, b] = [r, g, b].map((x) => x * (lumMod ?? 1) + 255 * (lumOff ?? 0));
  if (tint != null) [r, g, b] = [r, g, b].map((x) => x * tint + 255 * (1 - tint));
  if (shade != null) [r, g, b] = [r, g, b].map((x) => x * shade);
  [r, g, b] = [r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))));
  const alpha = mod('alpha');
  return alpha != null ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** A pause to call inside a long loop: every `every` calls it hands the
 *  page back for a moment, so reading a big file never freezes the screen
 *  (the readers need DOMParser, which a worker does not have). */
export function breather(every: number): () => Promise<void> {
  let n = 0;
  return async () => { if (++n % every === 0) await new Promise((r) => setTimeout(r, 0)); };
}

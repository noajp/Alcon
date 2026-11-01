import JSZip from 'jszip';

// A PowerPoint deck read for drawing: each slide's shapes where the deck
// puts them — rectangles, ellipses, lines, text boxes, pictures, tables —
// with their fills, outlines and type. Positions are in CSS pixels at the
// deck's own size (EMU / 9525); DeckView scales the slide to fit. What it
// does not read (charts, gradients, effects, master-only placeholders) is
// left out rather than guessed. The XML is read with DOMParser, so this
// runs in the browser (and under jsdom in the tests).

export interface Run { text: string; size: number; bold: boolean; italic: boolean; underline: boolean; color: string | null; font: string | null; spacing: number }
export interface Para { align: 'left' | 'center' | 'right' | 'justify'; runs: Run[]; bullet: boolean; lineHeight: number | null }
export interface TextBody { paras: Para[]; anchor: 'top' | 'middle' | 'bottom'; inset: [number, number, number, number]; vertical: boolean }
interface Box { x: number; y: number; w: number; h: number; rot: number }
export type DeckItem =
  | ({ kind: 'shape'; geom: 'rect' | 'roundRect' | 'ellipse' | 'line'; flipH: boolean; flipV: boolean; fill: string | null; stroke: { color: string | null; width: number; dash: boolean } | null; text: TextBody | null } & Box)
  | ({ kind: 'image'; src: string } & Box)
  | ({ kind: 'table'; cols: number[]; rows: { h: number; cells: { text: TextBody; fill: string | null; span: number; skip: boolean }[] }[] } & Box);
export interface DeckSlide { background: string | null; items: DeckItem[] }
export interface Deck { width: number; height: number; slides: DeckSlide[] }

const EMU = 9525;
const px = (emu: string | null | undefined) => (emu ? Number(emu) / EMU : 0);

const kids = (el: Element | null | undefined, name: string) =>
  el ? Array.from(el.children).filter((c) => c.tagName === name) : [];
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0] ?? null;
const path = (el: Element | null | undefined, ...names: string[]) =>
  names.reduce<Element | null>((at, n) => kid(at, n), el ?? null);

type Theme = Record<string, string>;
const CLR_MAP: Record<string, string> = { tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2' };

/** A colour element (<a:srgbClr>, <a:schemeClr>, <a:sysClr>) as CSS, with
 *  its alpha and lumMod / lumOff applied. */
function colorOf(el: Element | null, theme: Theme): string | null {
  const c = el ? Array.from(el.children).find((n) => ['a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr'].includes(n.tagName)) : null;
  if (!c) return null;
  let hex = c.tagName === 'a:srgbClr' ? c.getAttribute('val')
    : c.tagName === 'a:sysClr' ? c.getAttribute('lastClr')
    : c.tagName === 'a:schemeClr' ? theme[CLR_MAP[c.getAttribute('val') ?? ''] ?? c.getAttribute('val') ?? '']
    : ({ black: '000000', white: 'FFFFFF' } as Record<string, string>)[c.getAttribute('val') ?? ''];
  if (!hex) return null;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex!.slice(i, i + 2), 16));
  const mod = kid(c, 'a:lumMod')?.getAttribute('val');
  const off = kid(c, 'a:lumOff')?.getAttribute('val');
  if (mod || off) {
    const m = mod ? Number(mod) / 100000 : 1, o = off ? Number(off) / 100000 : 0;
    [r, g, b] = [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v * m + 255 * o))));
  }
  hex = [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const alpha = kid(c, 'a:alpha')?.getAttribute('val');
  return alpha ? `rgba(${r}, ${g}, ${b}, ${Number(alpha) / 100000})` : `#${hex}`;
}

function fillOf(spPr: Element | null, theme: Theme): string | null {
  return colorOf(kid(spPr, 'a:solidFill'), theme);
}

function boxOf(xfrm: Element | null): Box {
  const off = kid(xfrm, 'a:off'), ext = kid(xfrm, 'a:ext');
  return { x: px(off?.getAttribute('x')), y: px(off?.getAttribute('y')), w: px(ext?.getAttribute('cx')), h: px(ext?.getAttribute('cy')), rot: Number(xfrm?.getAttribute('rot') ?? 0) / 60000 };
}

function textOf(txBody: Element | null, theme: Theme): TextBody | null {
  if (!txBody) return null;
  const bodyPr = kid(txBody, 'a:bodyPr');
  const ins = (a: string, d: number) => (bodyPr?.getAttribute(a) != null ? px(bodyPr.getAttribute(a)) : d);
  const paras: Para[] = kids(txBody, 'a:p').map((p) => {
    const pPr = kid(p, 'a:pPr');
    const algn = pPr?.getAttribute('algn');
    const lnPct = path(pPr, 'a:lnSpc', 'a:spcPct')?.getAttribute('val');
    const runs: Run[] = Array.from(p.children).filter((r) => r.tagName === 'a:r' || r.tagName === 'a:br' || r.tagName === 'a:fld').map((r) => {
      const rPr = kid(r, 'a:rPr');
      return {
        text: r.tagName === 'a:br' ? '\n' : kid(r, 'a:t')?.textContent ?? '',
        size: rPr?.getAttribute('sz') ? Number(rPr.getAttribute('sz')) / 100 : 18,
        bold: rPr?.getAttribute('b') === '1',
        italic: rPr?.getAttribute('i') === '1',
        underline: !!rPr?.getAttribute('u') && rPr.getAttribute('u') !== 'none',
        color: colorOf(kid(rPr, 'a:solidFill'), theme),
        font: kid(rPr, 'a:ea')?.getAttribute('typeface') ?? kid(rPr, 'a:latin')?.getAttribute('typeface') ?? null,
        spacing: rPr?.getAttribute('spc') ? Number(rPr.getAttribute('spc')) / 100 : 0,
      };
    });
    return {
      align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left',
      runs,
      bullet: !!kid(pPr, 'a:buChar') || !!kid(pPr, 'a:buAutoNum'),
      lineHeight: lnPct ? Number(lnPct) / 100000 : null,
    } satisfies Para;
  });
  const anchor = bodyPr?.getAttribute('anchor');
  return {
    paras,
    anchor: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top',
    inset: [ins('tIns', 3.6), ins('rIns', 7.2), ins('bIns', 3.6), ins('lIns', 7.2)],
    vertical: (bodyPr?.getAttribute('vert') ?? 'horz').startsWith('vert') || bodyPr?.getAttribute('vert') === 'eaVert',
  };
}

function strokeOf(spPr: Element | null, theme: Theme, isLine: boolean) {
  const ln = kid(spPr, 'a:ln');
  if (!ln || kid(ln, 'a:noFill')) return null;
  const color = colorOf(kid(ln, 'a:solidFill'), theme);
  if (!color && !isLine) return null;
  const dash = kid(ln, 'a:prstDash')?.getAttribute('val');
  // No colour on a line means the deck's default ink; the view draws it.
  return { color, width: Math.max(0.75, px(ln.getAttribute('w') ?? '9525')), dash: !!dash && dash !== 'solid' };
}

/** A group's children, moved and scaled from the group's child space into
 *  its place on the slide. */
function place(items: DeckItem[], grpXfrm: Element | null): DeckItem[] {
  const at = boxOf(grpXfrm);
  const chOff = kid(grpXfrm, 'a:chOff'), chExt = kid(grpXfrm, 'a:chExt');
  const cx = px(chOff?.getAttribute('x')), cy = px(chOff?.getAttribute('y'));
  const sx = px(chExt?.getAttribute('cx')) ? at.w / px(chExt?.getAttribute('cx')) : 1;
  const sy = px(chExt?.getAttribute('cy')) ? at.h / px(chExt?.getAttribute('cy')) : 1;
  return items.map((it) => ({ ...it, x: at.x + (it.x - cx) * sx, y: at.y + (it.y - cy) * sy, w: it.w * sx, h: it.h * sy }));
}

async function itemsOf(tree: Element, theme: Theme, media: (rId: string) => Promise<string | null>): Promise<DeckItem[]> {
  const out: DeckItem[] = [];
  for (const node of Array.from(tree.children)) {
    if (node.tagName === 'p:sp' || node.tagName === 'p:cxnSp') {
      const spPr = kid(node, 'p:spPr');
      const xfrm = kid(spPr, 'a:xfrm');
      if (!xfrm) continue; // a placeholder placed only by its layout
      const prst = kid(spPr, 'a:prstGeom')?.getAttribute('prst') ?? 'rect';
      const geom = prst === 'line' || prst.startsWith('straightConnector') || node.tagName === 'p:cxnSp' ? 'line'
        : prst === 'ellipse' ? 'ellipse' : prst === 'roundRect' ? 'roundRect' : 'rect';
      out.push({
        kind: 'shape', geom, ...boxOf(xfrm),
        flipH: xfrm.getAttribute('flipH') === '1', flipV: xfrm.getAttribute('flipV') === '1',
        fill: geom === 'line' ? null : fillOf(spPr, theme),
        stroke: strokeOf(spPr, theme, geom === 'line'),
        text: textOf(kid(node, 'p:txBody'), theme),
      });
    } else if (node.tagName === 'p:pic') {
      const rId = path(node, 'p:blipFill', 'a:blip')?.getAttribute('r:embed');
      const src = rId ? await media(rId) : null;
      if (src) out.push({ kind: 'image', src, ...boxOf(path(node, 'p:spPr', 'a:xfrm')) });
    } else if (node.tagName === 'p:grpSp') {
      out.push(...place(await itemsOf(node, theme, media), path(node, 'p:grpSpPr', 'a:xfrm')));
    } else if (node.tagName === 'p:graphicFrame') {
      const tbl = node.getElementsByTagName('a:tbl')[0];
      if (!tbl) continue;
      out.push({
        kind: 'table', ...boxOf(kid(node, 'p:xfrm')),
        cols: kids(kid(tbl, 'a:tblGrid'), 'a:gridCol').map((c) => px(c.getAttribute('w'))),
        rows: kids(tbl, 'a:tr').map((tr) => ({
          h: px(tr.getAttribute('h')),
          cells: kids(tr, 'a:tc').map((tc) => ({
            text: textOf(kid(tc, 'a:txBody'), theme) ?? { paras: [], anchor: 'top' as const, inset: [3.6, 7.2, 3.6, 7.2] as [number, number, number, number], vertical: false },
            fill: colorOf(kid(kid(tc, 'a:tcPr'), 'a:solidFill'), theme),
            span: Number(tc.getAttribute('gridSpan') ?? 1),
            skip: tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1',
          })),
        })),
      });
    }
  }
  return out;
}

/** Pure on its input. Reads a .pptx's bytes into its slides. */
export async function readDeck(bytes: ArrayBuffer): Promise<Deck> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = async (p: string) => {
    const f = zip.file(p);
    return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null;
  };
  const relsOf = async (p: string) => {
    const dir = p.slice(0, p.lastIndexOf('/'));
    const doc = await xml(`${dir}/_rels/${p.slice(dir.length + 1)}.rels`);
    const map = new Map<string, string>();
    for (const r of Array.from(doc?.getElementsByTagName('Relationship') ?? [])) {
      const target = r.getAttribute('Target') ?? '';
      map.set(r.getAttribute('Id') ?? '', target.startsWith('/') ? target.slice(1) : new URL(target, `http://x/${dir}/`).pathname.slice(1));
    }
    return map;
  };

  const pres = await xml('ppt/presentation.xml');
  const size = pres?.getElementsByTagName('p:sldSz')[0];
  const presRels = await relsOf('ppt/presentation.xml');

  const theme: Theme = {};
  const themePath = [...presRels.values()].find((t) => t.includes('theme/'));
  const scheme = themePath ? (await xml(themePath))?.getElementsByTagName('a:clrScheme')[0] : null;
  for (const c of Array.from(scheme?.children ?? [])) {
    const v = c.children[0];
    theme[c.tagName.replace('a:', '')] = (v?.getAttribute('val') ?? v?.getAttribute('lastClr') ?? '000000');
  }

  const slidePaths = Array.from(pres?.getElementsByTagName('p:sldId') ?? [])
    .map((s) => presRels.get(s.getAttribute('r:id') ?? ''))
    .filter((p): p is string => !!p);

  const slides: DeckSlide[] = [];
  for (const p of slidePaths) {
    const doc = await xml(p);
    const cSld = doc?.getElementsByTagName('p:cSld')[0];
    const tree = kid(cSld, 'p:spTree');
    if (!tree) continue;
    const rels = await relsOf(p);
    const media = async (rId: string) => {
      const target = rels.get(rId);
      const f = target ? zip.file(target) : null;
      if (!f) return null;
      const ext = target!.split('.').pop()?.toLowerCase();
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      return `data:${mime};base64,${await f.async('base64')}`;
    };
    slides.push({
      background: colorOf(path(cSld, 'p:bg', 'p:bgPr', 'a:solidFill'), theme),
      items: await itemsOf(tree, theme, media),
    });
  }
  return { width: px(size?.getAttribute('cx')) || 960, height: px(size?.getAttribute('cy')) || 540, slides };
}

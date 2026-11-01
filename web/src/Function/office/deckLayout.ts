import { readChart, type ChartData } from './chartLayout';
import { presetPath } from './presetGeometry';
import { desc, drawingColor, emu as px, first, is, kid, kids, openPackage, path, relId, relOfType, themeColors, themeFonts, type Package, type Rel } from './ooxml';

// A PowerPoint deck read for drawing: each slide's shapes where the deck
// puts them — rectangles, ellipses, lines, text, pictures, tables, groups —
// with their fills (solid or gradient), outlines and type.
//
// A deck made in PowerPoint keeps much of a slide on its layout and master:
// a title or body placeholder often carries no position of its own, and its
// size, colour, bullets and alignment come from the layout's placeholder,
// then the master's, then the master's text styles. Those are followed here
// in that order, as PowerPoint does, along with theme colours and fonts,
// background inheritance, the master's and layout's own decoration, picture
// cropping and shrink-on-overflow. Positions are CSS pixels at the deck's
// size (EMU / 9525); DeckView scales the slide to fit. Charts, effects and
// custom geometry are left out rather than guessed. Read with DOMParser —
// the browser, or jsdom in the tests.

export interface Run { text: string; size: number; bold: boolean; italic: boolean; underline: boolean; color: string | null; font: string | null; spacing: number }
export interface Para {
  align: 'left' | 'center' | 'right' | 'justify'; runs: Run[]; bullet: string | null; indent: number; lineHeight: number | null;
  /** On a slide's own shape, when the paragraph is plain text runs only
   *  (no line break or field): its order in the shape's text, so it can be
   *  edited as text (see officeEdits). */
  src?: number;
}
export interface TextBody { paras: Para[]; anchor: 'top' | 'middle' | 'bottom'; inset: [number, number, number, number]; vertical: boolean; wrap: boolean }
interface Box { x: number; y: number; w: number; h: number; rot: number }
export type DeckItem =
  | ({ kind: 'shape'; geom: string; adj: Record<string, number>; flipH: boolean; flipV: boolean; fill: string | null; stroke: Stroke | null; text: TextBody | null;
    /** The shape's id on its slide (cNvPr), for a shape of the slide itself. */
    spId?: string } & Box)
  | ({ kind: 'chart'; chart: ChartData } & Box)
  | ({ kind: 'image'; src: string; crop: { l: number; t: number; r: number; b: number } } & Box)
  | ({ kind: 'table'; cols: number[]; rows: { h: number; cells: { text: TextBody; fill: string | null; span: number; skip: boolean }[] }[] } & Box);
export interface Stroke { color: string | null; width: number; dash: boolean; head: boolean; tail: boolean }
export interface DeckSlide { background: string | null; items: DeckItem[] }
export interface Deck { width: number; height: number; slides: DeckSlide[] }

interface Theme {
  colors: Record<string, string>;
  fonts: { major: string | null; minor: string | null };
  /** The theme's format scheme: the fills and lines a shape's <p:style>
   *  points at by index, coloured by the reference's own colour. */
  styles: { fill: Element[]; line: Element[]; bgFill: Element[] };
}
/** A colour element as CSS, in the deck's theme (see ooxml). */
const colorOf = (el: Element | null, theme: Theme, ph: string | null = null) => drawingColor(el, theme.colors, ph);

/** A shape's or background's fill as CSS: a colour, or a linear gradient
 *  (DrawingML's angle runs clockwise from left-to-right; CSS's from
 *  bottom-to-top, hence the quarter turn). */
function fillEl(el: Element, theme: Theme, ph: string | null = null): string | null {
  if (is(el, 'solidFill')) return colorOf(el, theme, ph);
  if (is(el, 'pattFill')) return colorOf(kid(el, 'a:fgClr'), theme, ph);
  if (is(el, 'gradFill')) {
    const stops = kids(kid(el, 'a:gsLst'), 'a:gs')
      .map((gs) => ({ pos: Number(gs.getAttribute('pos') ?? 0) / 1000, color: colorOf(gs, theme, ph) }))
      .filter((s) => s.color)
      .sort((a, b) => a.pos - b.pos);
    if (!stops.length) return null;
    if (stops.length === 1) return stops[0].color;
    const ang = Number(kid(el, 'a:lin')?.getAttribute('ang') ?? 0) / 60000;
    return `linear-gradient(${ang + 90}deg, ${stops.map((s) => `${s.color} ${s.pos}%`).join(', ')})`;
  }
  return null;
}
const FILLS = ['solidFill', 'gradFill', 'pattFill', 'noFill', 'blipFill', 'grpFill'];
/** The fill a properties element sets: CSS, null for an explicit "no
 *  fill", undefined when it says nothing (and the fill is inherited). */
function fillOf(spPr: Element | null, theme: Theme): string | null | undefined {
  const el = spPr ? Array.from(spPr.children).find((c) => FILLS.includes(c.localName)) : null;
  return el ? fillEl(el, theme) : undefined;
}
/** The first value that is set (null counts: it means "none"). */
const firstSet = <T,>(...vals: (T | null | undefined)[]): T | null => vals.find((v) => v !== undefined) ?? null;

/** The hex a style reference (<a:fillRef>, <a:lnRef>, <a:fontRef>) carries. */
const refHex = (ref: Element | null, theme: Theme) => colorOf(ref, theme)?.match(/^#([0-9a-f]{6})$/i)?.[1] ?? null;
/** A shape's fill from its <p:style>: the theme's fill at that index. */
function styleFill(style: Element | null, theme: Theme): string | null | undefined {
  const ref = kid(style, 'a:fillRef');
  if (!ref) return undefined;
  const idx = Number(ref.getAttribute('idx') ?? 0);
  if (idx === 0) return null;
  const el = idx >= 1001 ? theme.styles.bgFill[idx - 1001] : theme.styles.fill[idx - 1];
  return el ? fillEl(el, theme, refHex(ref, theme)) : undefined;
}

function boxOf(xfrm: Element | null): Box | null {
  if (!xfrm) return null;
  const off = kid(xfrm, 'a:off'), ext = kid(xfrm, 'a:ext');
  return { x: px(off?.getAttribute('x')), y: px(off?.getAttribute('y')), w: px(ext?.getAttribute('cx')), h: px(ext?.getAttribute('cy')), rot: Number(xfrm.getAttribute('rot') ?? 0) / 60000 };
}

// ── Placeholders and text inheritance ─────────────────────────────────────

interface Placeholder { box: Box | null; lstStyle: Element | null; bodyPr: Element | null; spPr: Element | null }
interface PlaceholderMaps { byIdx: Map<string, Placeholder>; byType: Map<string, Placeholder> }

/** The placeholder kind a <p:ph> names; no type means body content. */
const phType = (ph: Element) => ph.getAttribute('type') ?? 'body';
/** The master holds titles and bodies; the finer kinds fall back to them. */
const masterType = (t: string) => (t === 'ctrTitle' ? 'title' : ['subTitle', 'obj', 'body', 'tbl', 'chart', 'pic', 'media', 'clipArt', 'dgm'].includes(t) ? 'body' : t);

function placeholdersOf(tree: Element | null): PlaceholderMaps {
  const maps: PlaceholderMaps = { byIdx: new Map(), byType: new Map() };
  for (const sp of desc(tree, 'sp')) {
    const ph = first(sp, 'ph');
    if (!ph) continue;
    const spPr = kid(sp, 'p:spPr');
    const txBody = kid(sp, 'p:txBody');
    const entry: Placeholder = { box: boxOf(kid(spPr, 'a:xfrm')), lstStyle: kid(txBody, 'a:lstStyle'), bodyPr: kid(txBody, 'a:bodyPr'), spPr };
    const idx = ph.getAttribute('idx');
    if (idx) maps.byIdx.set(idx, entry);
    if (!maps.byType.has(phType(ph))) maps.byType.set(phType(ph), entry);
  }
  return maps;
}

interface Inherit {
  layout: PlaceholderMaps;
  master: PlaceholderMaps;
  txStyles: { title: Element | null; body: Element | null; other: Element | null };
  defaultText: Element | null;
}

/** The placeholders a slide shape inherits from, nearest first. */
function inheritedOf(ph: Element | null, inh: Inherit | null): Placeholder[] {
  if (!ph || !inh) return [];
  const t = phType(ph), idx = ph.getAttribute('idx');
  const layout = (idx ? inh.layout.byIdx.get(idx) : null) ?? inh.layout.byType.get(t) ?? inh.layout.byType.get(masterType(t));
  const master = inh.master.byType.get(t) ?? inh.master.byType.get(masterType(t));
  return [layout, master].filter((p): p is Placeholder => !!p);
}

/** The list styles a shape's text falls back to, nearest first. */
function styleChain(txBody: Element | null, ph: Element | null, inh: Inherit | null): Element[] {
  const own = kid(txBody, 'a:lstStyle');
  if (!inh) return own ? [own] : [];
  const fromPh = inheritedOf(ph, inh).map((p) => p.lstStyle);
  const master = !ph ? inh.defaultText : masterType(phType(ph)) === 'title' ? inh.txStyles.title
    : masterType(phType(ph)) === 'body' ? inh.txStyles.body : inh.txStyles.other;
  return [own, ...fromPh, master].filter((e): e is Element => !!e);
}

function themeFont(face: string | null | undefined, theme: Theme): string | null {
  if (!face) return null;
  if (face.startsWith('+mj')) return theme.fonts.major;
  if (face.startsWith('+mn')) return theme.fonts.minor;
  return face;
}

/** A shape's <p:style> font reference: the theme font and colour its text
 *  takes when nothing nearer names one. */
function styleFont(style: Element | null, theme: Theme): { font: string | null; color: string | null } | null {
  const ref = kid(style, 'a:fontRef');
  if (!ref) return null;
  const idx = ref.getAttribute('idx');
  return { font: idx === 'major' ? theme.fonts.major : idx === 'minor' ? theme.fonts.minor : null, color: colorOf(ref, theme) };
}

function textOf(txBody: Element | null, theme: Theme, chain: Element[], bodyPrs: Element[], fallback: { font: string | null; color: string | null } | null = null, editable = false): TextBody | null {
  if (!txBody) return null;
  const bodies = [kid(txBody, 'a:bodyPr'), ...bodyPrs].filter((e): e is Element => !!e);
  const attr = (a: string) => bodies.map((b) => b.getAttribute(a)).find((v) => v != null) ?? null;
  const ins = (a: string, d: number) => { const v = attr(a); return v != null ? px(v) : d; };
  // Shrink on overflow: PowerPoint stores the scale it settled on.
  const autofit = bodies.map((b) => kid(b, 'a:normAutofit')).find(Boolean);
  const fontScale = autofit?.getAttribute('fontScale') ? Number(autofit.getAttribute('fontScale')) / 100000 : 1;
  const lnReduce = autofit?.getAttribute('lnSpcReduction') ? Number(autofit.getAttribute('lnSpcReduction')) / 100000 : 0;

  const paras: Para[] = kids(txBody, 'a:p').map((p, index) => {
    const pPr = kid(p, 'a:pPr');
    const lvl = Number(pPr?.getAttribute('lvl') ?? 0);
    const levels = [pPr, ...chain.map((ls) => kid(ls, `a:lvl${lvl + 1}pPr`))].filter((e): e is Element => !!e);
    const pAttr = (a: string) => levels.map((l) => l.getAttribute(a)).find((v) => v != null) ?? null;
    const algn = pAttr('algn');
    const lnPct = levels.map((l) => path(l, 'a:lnSpc', 'a:spcPct')?.getAttribute('val')).find(Boolean);
    const bulletLevel = levels.find((l) => kid(l, 'a:buNone') || kid(l, 'a:buChar') || kid(l, 'a:buAutoNum'));
    const bullet = !bulletLevel || kid(bulletLevel, 'a:buNone') ? null : kid(bulletLevel, 'a:buChar')?.getAttribute('char') ?? '•';
    const defaults = levels.map((l) => (is(l, 'pPr') ? null : kid(l, 'a:defRPr'))).filter((e): e is Element => !!e);
    const runs: Run[] = Array.from(p.children).filter((r) => is(r, 'r') || is(r, 'br') || is(r, 'fld')).map((r) => {
      const rPrs = [kid(r, 'a:rPr'), ...defaults].filter((e): e is Element => !!e);
      const rAttr = (a: string) => rPrs.map((x) => x.getAttribute(a)).find((v) => v != null) ?? null;
      const colorEl = rPrs.map((x) => kid(x, 'a:solidFill')).find(Boolean) ?? null;
      const face = rPrs.map((x) => kid(x, 'a:ea')?.getAttribute('typeface') ?? kid(x, 'a:latin')?.getAttribute('typeface')).find(Boolean);
      const u = rAttr('u');
      return {
        text: is(r, 'br') ? '\n' : kid(r, 'a:t')?.textContent ?? '',
        size: (rAttr('sz') ? Number(rAttr('sz')) / 100 : 18) * fontScale,
        bold: rAttr('b') === '1',
        italic: rAttr('i') === '1',
        underline: !!u && u !== 'none',
        color: colorOf(colorEl, theme) ?? fallback?.color ?? null,
        font: themeFont(face, theme) ?? fallback?.font ?? null,
        spacing: rAttr('spc') ? Number(rAttr('spc')) / 100 : 0,
      };
    });
    return {
      align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left',
      runs,
      bullet,
      indent: px(pAttr('marL')),
      lineHeight: lnPct ? (Number(lnPct) / 100000) * (1 - lnReduce) * 1.2 : null,
      ...(editable && Array.from(p.children).every((c) => is(c, 'pPr') || is(c, 'r') || is(c, 'endParaRPr')) ? { src: index } : {}),
    } satisfies Para;
  });
  const anchor = attr('anchor');
  const vert = attr('vert') ?? 'horz';
  return {
    paras,
    anchor: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top',
    inset: [ins('tIns', 3.6), ins('rIns', 7.2), ins('bIns', 3.6), ins('lIns', 7.2)],
    vertical: vert.startsWith('vert') || vert === 'eaVert',
    wrap: attr('wrap') !== 'none',
  };
}

/** A shape's outline: its own <a:ln>, over the line its <p:style> points
 *  at in the theme; arrowheads where either end asks for one. */
function strokeOf(spPr: Element | null, theme: Theme, isLine: boolean, style: Element | null): Stroke | null {
  const own = kid(spPr, 'a:ln');
  const ref = kid(style, 'a:lnRef');
  const idx = Number(ref?.getAttribute('idx') ?? 0);
  const themed = idx > 0 ? theme.styles.line[idx - 1] ?? null : null;
  const ph = refHex(ref, theme);
  if (own && kid(own, 'a:noFill')) return null;
  const lns = [own, themed].filter((e): e is Element => !!e);
  if (!lns.length) return null;
  const color = lns.map((l) => colorOf(kid(l, 'a:solidFill'), theme, l === themed ? ph : null)).find(Boolean) ?? null;
  if (!color && !isLine) return null;
  const width = lns.map((l) => l.getAttribute('w')).find(Boolean) ?? '9525';
  const dash = lns.map((l) => kid(l, 'a:prstDash')?.getAttribute('val')).find(Boolean);
  const end = (name: string) => { const t = lns.map((l) => kid(l, name)?.getAttribute('type')).find(Boolean); return !!t && t !== 'none'; };
  // No colour on a line means the deck's default ink; the view draws it.
  return { color, width: Math.max(0.75, px(width)), dash: !!dash && dash !== 'solid', head: end('a:headEnd'), tail: end('a:tailEnd') };
}

/** A group's children, moved and scaled from the group's child space into
 *  its place on the slide. */
function place(items: DeckItem[], grpXfrm: Element | null): DeckItem[] {
  const at = boxOf(grpXfrm) ?? { x: 0, y: 0, w: 0, h: 0, rot: 0 };
  const chOff = kid(grpXfrm, 'a:chOff'), chExt = kid(grpXfrm, 'a:chExt');
  const cx = px(chOff?.getAttribute('x')), cy = px(chOff?.getAttribute('y'));
  const sx = px(chExt?.getAttribute('cx')) ? at.w / px(chExt?.getAttribute('cx')) : 1;
  const sy = px(chExt?.getAttribute('cy')) ? at.h / px(chExt?.getAttribute('cy')) : 1;
  return items.map((it) => ({ ...it, x: at.x + (it.x - cx) * sx, y: at.y + (it.y - cy) * sy, w: it.w * sx, h: it.h * sy }));
}

interface ReadCtx {
  theme: Theme;
  pkg: Package;
  /** The relationships of the part being read (slide, layout, master,
   *  diagram drawing): what its r:ids point at. */
  rels: Map<string, Rel>;
  /** null on a layout or master: their placeholders are templates, not content. */
  inherit: Inherit | null;
}

async function itemsOf(tree: Element, ctx: ReadCtx): Promise<DeckItem[]> {
  const { theme } = ctx;
  const out: DeckItem[] = [];
  for (const node of Array.from(tree.children)) {
    const ph = first(node, 'ph');
    if (ph && !ctx.inherit) continue;
    const from = inheritedOf(ph, ctx.inherit);
    if (is(node, 'sp') || is(node, 'cxnSp')) {
      const spPr = kid(node, 'p:spPr');
      const xfrm = kid(spPr, 'a:xfrm');
      const box = boxOf(xfrm) ?? from.map((p) => p.box).find(Boolean) ?? null;
      if (!box) continue;
      const prstGeom = kid(spPr, 'a:prstGeom');
      const geom = prstGeom?.getAttribute('prst') ?? (is(node, 'cxnSp') ? 'line' : 'rect');
      // Adjust values: <a:gd name="adj" fmla="val 16667"/>.
      const adj: Record<string, number> = {};
      for (const gd of kids(kid(prstGeom, 'a:avLst'), 'a:gd')) {
        const v = /^val (-?\d+)/.exec(gd.getAttribute('fmla') ?? '')?.[1];
        if (v != null) adj[gd.getAttribute('name') ?? ''] = Number(v);
      }
      const isLine = presetPath(geom, box.w, box.h, adj)?.line ?? false;
      const style = kid(node, 'p:style');
      const txBody = kid(node, 'p:txBody');
      out.push({
        kind: 'shape', geom, adj, ...box,
        flipH: xfrm?.getAttribute('flipH') === '1', flipV: xfrm?.getAttribute('flipV') === '1',
        // Own fill, else the placeholder's it inherits, else its style's.
        fill: isLine ? null : firstSet(fillOf(spPr, theme), ...from.map((p) => fillOf(p.spPr, theme)), styleFill(style, theme)),
        stroke: strokeOf(spPr, theme, isLine, style),
        text: textOf(txBody, theme, styleChain(txBody, ph, ctx.inherit), from.map((p) => p.bodyPr).filter((e): e is Element => !!e), styleFont(style, theme), !!ctx.inherit),
        // The slide's own shapes (not its layout's or master's) can be edited.
        ...(ctx.inherit && first(node, 'cNvPr')?.getAttribute('id') ? { spId: first(node, 'cNvPr')!.getAttribute('id')! } : {}),
      });
    } else if (is(node, 'pic')) {
      const blipFill = kid(node, 'p:blipFill');
      const src = await ctx.pkg.dataUrl(ctx.rels.get(relId(kid(blipFill, 'a:blip'), 'embed') ?? '')?.target);
      const box = boxOf(path(node, 'p:spPr', 'a:xfrm')) ?? from.map((p) => p.box).find(Boolean) ?? null;
      const rect = kid(blipFill, 'a:srcRect');
      const crop = (a: string) => Number(rect?.getAttribute(a) ?? 0) / 100000;
      if (src && box) out.push({ kind: 'image', src, ...box, crop: { l: crop('l'), t: crop('t'), r: crop('r'), b: crop('b') } });
    } else if (is(node, 'grpSp')) {
      out.push(...place(await itemsOf(node, ctx), path(node, 'p:grpSpPr', 'a:xfrm')));
    } else if (is(node, 'graphicFrame')) {
      const tbl = first(node, 'tbl');
      const box = boxOf(kid(node, 'p:xfrm')) ?? from.map((p) => p.box).find(Boolean) ?? null;
      const chartRef = first(node, 'chart');
      if (chartRef && box) {
        const doc = await ctx.pkg.xml(ctx.rels.get(relId(chartRef) ?? '')?.target ?? '');
        const chart = doc ? readChart(doc, ctx.theme.colors) : null;
        if (chart) out.push({ kind: 'chart', chart, ...box });
        continue;
      }
      // SmartArt: its layout engine is PowerPoint's, but the file keeps the
      // shapes it last drew (the diagram drawing part) — those are drawn,
      // placed in the frame.
      const diagram = first(node, 'relIds');
      if (diagram && box) {
        const data = await ctx.pkg.xml(ctx.rels.get(relId(diagram, 'dm') ?? '')?.target ?? '');
        const drawingId = first(data, 'dataModelExt')?.getAttribute('relId');
        const drawingPath = (drawingId ? ctx.rels.get(drawingId)?.target : null) ?? relOfType(ctx.rels, 'diagramDrawing');
        const drawing = drawingPath ? await ctx.pkg.xml(drawingPath) : null;
        const tree = first(drawing, 'spTree');
        if (tree && drawingPath) {
          const shapes = await itemsOf(tree, { ...ctx, rels: await ctx.pkg.rels(drawingPath), inherit: null });
          out.push(...shapes.map((it) => ({ ...it, x: it.x + box.x, y: it.y + box.y })));
        }
        continue;
      }
      if (!tbl || !box) continue;
      out.push({
        kind: 'table', ...box,
        cols: kids(kid(tbl, 'a:tblGrid'), 'a:gridCol').map((c) => px(c.getAttribute('w'))),
        rows: kids(tbl, 'a:tr').map((tr) => ({
          h: px(tr.getAttribute('h')),
          cells: kids(tr, 'a:tc').map((tc) => ({
            text: textOf(kid(tc, 'a:txBody'), theme, ctx.inherit?.defaultText ? [ctx.inherit.defaultText] : [], [])
              ?? { paras: [], anchor: 'top' as const, inset: [3.6, 7.2, 3.6, 7.2] as [number, number, number, number], vertical: false, wrap: true },
            fill: fillOf(kid(tc, 'a:tcPr'), theme) ?? null,
            span: Number(tc.getAttribute('gridSpan') ?? 1),
            skip: tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1',
          })),
        })),
      });
    }
  }
  return out;
}

/** Reads a .pptx's bytes into its slides. */
export async function readDeck(bytes: ArrayBuffer): Promise<Deck> {
  const pkg = await openPackage(bytes);
  const { xml } = pkg;
  const relsOf = (p: string) => pkg.rels(p);

  const pres = await xml('ppt/presentation.xml');
  const size = first(pres, 'sldSz');
  const presRels = await relsOf('ppt/presentation.xml');
  const defaultText = first(pres, 'defaultTextStyle');

  const slidePaths = desc(pres, 'sldId')
    .map((s) => presRels.get(relId(s) ?? '')?.target)
    .filter((p): p is string => !!p);

  const themes = new Map<string, Theme>();
  const themeOf = async (masterPath: string): Promise<Theme> => {
    const themePath = relOfType(await relsOf(masterPath), 'theme') ?? relOfType(presRels, 'theme');
    const key = themePath ?? '';
    if (!themes.has(key)) {
      const doc = themePath ? await xml(themePath) : null;
      const list = (name: string) => Array.from(first(doc, name)?.children ?? []);
      themes.set(key, {
        colors: themeColors(doc), fonts: themeFonts(doc),
        styles: { fill: list('fillStyleLst'), line: list('lnStyleLst'), bgFill: list('bgFillStyleLst') },
      });
    }
    return themes.get(key)!;
  };

  const slides: DeckSlide[] = [];
  for (const p of slidePaths) {
    // Hand the page back between slides, so a long deck never freezes it.
    await new Promise((r) => setTimeout(r, 0));
    const doc = await xml(p);
    const cSld = first(doc, 'cSld');
    const tree = kid(cSld, 'p:spTree');
    if (!doc || !tree) continue;
    const rels = await relsOf(p);
    const layoutPath = relOfType(rels, 'slideLayout');
    const layoutDoc = layoutPath ? await xml(layoutPath) : null;
    const layoutRels = layoutPath ? await relsOf(layoutPath) : new Map<string, Rel>();
    const masterPath = layoutPath ? relOfType(layoutRels, 'slideMaster') : null;
    const masterDoc = masterPath ? await xml(masterPath) : null;
    const masterRels = masterPath ? await relsOf(masterPath) : new Map<string, Rel>();
    const theme = masterPath ? await themeOf(masterPath) : await themeOf('ppt/presentation.xml');
    const layoutTree = path(layoutDoc?.documentElement, 'p:cSld', 'p:spTree');
    const masterTree = path(masterDoc?.documentElement, 'p:cSld', 'p:spTree');
    const txStyles = first(masterDoc, 'txStyles');

    const inherit: Inherit = {
      layout: placeholdersOf(layoutTree), master: placeholdersOf(masterTree),
      txStyles: { title: kid(txStyles, 'p:titleStyle'), body: kid(txStyles, 'p:bodyStyle'), other: kid(txStyles, 'p:otherStyle') },
      defaultText,
    };

    // The background is the slide's, else its layout's, else its master's.
    const bgOf = async (root: Element | null | undefined, r: Map<string, Rel>) => {
      const bgPr = path(root, 'p:cSld', 'p:bg', 'p:bgPr');
      if (!bgPr) return null;
      const blip = relId(path(bgPr, 'a:blipFill', 'a:blip'), 'embed');
      if (blip) { const src = await pkg.dataUrl(r.get(blip)?.target); return src ? `center / cover no-repeat url("${src}")` : null; }
      return fillOf(bgPr, theme) ?? null;
    };
    const background = (await bgOf(doc.documentElement, rels)) ?? (await bgOf(layoutDoc?.documentElement, layoutRels)) ?? (await bgOf(masterDoc?.documentElement, masterRels));

    // The master's and layout's own shapes (logos, rules, bands) sit under
    // the slide's, unless the slide or its layout hides them.
    const showMaster = doc.documentElement.getAttribute('showMasterSp') !== '0' && layoutDoc?.documentElement.getAttribute('showMasterSp') !== '0';
    const items: DeckItem[] = [];
    if (showMaster && masterTree) items.push(...await itemsOf(masterTree, { theme, pkg, rels: masterRels, inherit: null }));
    if (doc.documentElement.getAttribute('showMasterSp') !== '0' && layoutTree) items.push(...await itemsOf(layoutTree, { theme, pkg, rels: layoutRels, inherit: null }));
    items.push(...await itemsOf(tree, { theme, pkg, rels, inherit }));
    slides.push({ background, items });
  }
  return { width: px(size?.getAttribute('cx')) || 960, height: px(size?.getAttribute('cy')) || 540, slides };
}

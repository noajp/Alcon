import JSZip from 'jszip';

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
export interface Para { align: 'left' | 'center' | 'right' | 'justify'; runs: Run[]; bullet: string | null; indent: number; lineHeight: number | null }
export interface TextBody { paras: Para[]; anchor: 'top' | 'middle' | 'bottom'; inset: [number, number, number, number]; vertical: boolean; wrap: boolean }
interface Box { x: number; y: number; w: number; h: number; rot: number }
export type DeckItem =
  | ({ kind: 'shape'; geom: 'rect' | 'roundRect' | 'ellipse' | 'line'; flipH: boolean; flipV: boolean; fill: string | null; stroke: { color: string | null; width: number; dash: boolean } | null; text: TextBody | null } & Box)
  | ({ kind: 'image'; src: string; crop: { l: number; t: number; r: number; b: number } } & Box)
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

interface Theme {
  colors: Record<string, string>;
  fonts: { major: string | null; minor: string | null };
}
const CLR_MAP: Record<string, string> = { tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2' };

/** A colour element (<a:srgbClr>, <a:schemeClr>, <a:sysClr>) as CSS, with
 *  its alpha, lumMod / lumOff, tint and shade applied. */
function colorOf(el: Element | null, theme: Theme): string | null {
  const c = el ? Array.from(el.children).find((n) => ['a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr'].includes(n.tagName)) : null;
  if (!c) return null;
  const hex = c.tagName === 'a:srgbClr' ? c.getAttribute('val')
    : c.tagName === 'a:sysClr' ? c.getAttribute('lastClr')
    : c.tagName === 'a:schemeClr' ? theme.colors[CLR_MAP[c.getAttribute('val') ?? ''] ?? c.getAttribute('val') ?? '']
    : ({ black: '000000', white: 'FFFFFF' } as Record<string, string>)[c.getAttribute('val') ?? ''];
  if (!hex) return null;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const val = (name: string) => { const v = kid(c, name)?.getAttribute('val'); return v ? Number(v) / 100000 : null; };
  const mod = val('a:lumMod'), off = val('a:lumOff'), tint = val('a:tint'), shade = val('a:shade');
  if (mod != null || off != null) [r, g, b] = [r, g, b].map((v) => v * (mod ?? 1) + 255 * (off ?? 0));
  if (tint != null) [r, g, b] = [r, g, b].map((v) => v * tint + 255 * (1 - tint));
  if (shade != null) [r, g, b] = [r, g, b].map((v) => v * shade);
  [r, g, b] = [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))));
  const alpha = val('a:alpha');
  return alpha != null ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** A shape's or background's fill as CSS: a colour, or a linear gradient
 *  (DrawingML's angle runs clockwise from left-to-right; CSS's from
 *  bottom-to-top, hence the quarter turn). */
function fillOf(spPr: Element | null, theme: Theme): string | null {
  const solid = kid(spPr, 'a:solidFill');
  if (solid) return colorOf(solid, theme);
  const grad = kid(spPr, 'a:gradFill');
  if (grad) {
    const stops = kids(kid(grad, 'a:gsLst'), 'a:gs')
      .map((gs) => ({ pos: Number(gs.getAttribute('pos') ?? 0) / 1000, color: colorOf(gs, theme) }))
      .filter((s) => s.color)
      .sort((a, b) => a.pos - b.pos);
    if (!stops.length) return null;
    if (stops.length === 1) return stops[0].color;
    const ang = Number(kid(grad, 'a:lin')?.getAttribute('ang') ?? 0) / 60000;
    return `linear-gradient(${ang + 90}deg, ${stops.map((s) => `${s.color} ${s.pos}%`).join(', ')})`;
  }
  return null;
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
  for (const sp of tree ? Array.from(tree.getElementsByTagName('p:sp')) : []) {
    const ph = sp.getElementsByTagName('p:ph')[0];
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

function textOf(txBody: Element | null, theme: Theme, chain: Element[], bodyPrs: Element[]): TextBody | null {
  if (!txBody) return null;
  const bodies = [kid(txBody, 'a:bodyPr'), ...bodyPrs].filter((e): e is Element => !!e);
  const attr = (a: string) => bodies.map((b) => b.getAttribute(a)).find((v) => v != null) ?? null;
  const ins = (a: string, d: number) => { const v = attr(a); return v != null ? px(v) : d; };
  // Shrink on overflow: PowerPoint stores the scale it settled on.
  const autofit = bodies.map((b) => kid(b, 'a:normAutofit')).find(Boolean);
  const fontScale = autofit?.getAttribute('fontScale') ? Number(autofit.getAttribute('fontScale')) / 100000 : 1;
  const lnReduce = autofit?.getAttribute('lnSpcReduction') ? Number(autofit.getAttribute('lnSpcReduction')) / 100000 : 0;

  const paras: Para[] = kids(txBody, 'a:p').map((p) => {
    const pPr = kid(p, 'a:pPr');
    const lvl = Number(pPr?.getAttribute('lvl') ?? 0);
    const levels = [pPr, ...chain.map((ls) => kid(ls, `a:lvl${lvl + 1}pPr`))].filter((e): e is Element => !!e);
    const pAttr = (a: string) => levels.map((l) => l.getAttribute(a)).find((v) => v != null) ?? null;
    const algn = pAttr('algn');
    const lnPct = levels.map((l) => path(l, 'a:lnSpc', 'a:spcPct')?.getAttribute('val')).find(Boolean);
    const bulletLevel = levels.find((l) => kid(l, 'a:buNone') || kid(l, 'a:buChar') || kid(l, 'a:buAutoNum'));
    const bullet = !bulletLevel || kid(bulletLevel, 'a:buNone') ? null : kid(bulletLevel, 'a:buChar')?.getAttribute('char') ?? '•';
    const defaults = levels.map((l) => (l.tagName === 'a:pPr' ? null : kid(l, 'a:defRPr'))).filter((e): e is Element => !!e);
    const runs: Run[] = Array.from(p.children).filter((r) => r.tagName === 'a:r' || r.tagName === 'a:br' || r.tagName === 'a:fld').map((r) => {
      const rPrs = [kid(r, 'a:rPr'), ...defaults].filter((e): e is Element => !!e);
      const rAttr = (a: string) => rPrs.map((x) => x.getAttribute(a)).find((v) => v != null) ?? null;
      const colorEl = rPrs.map((x) => kid(x, 'a:solidFill')).find(Boolean) ?? null;
      const face = rPrs.map((x) => kid(x, 'a:ea')?.getAttribute('typeface') ?? kid(x, 'a:latin')?.getAttribute('typeface')).find(Boolean);
      const u = rAttr('u');
      return {
        text: r.tagName === 'a:br' ? '\n' : kid(r, 'a:t')?.textContent ?? '',
        size: (rAttr('sz') ? Number(rAttr('sz')) / 100 : 18) * fontScale,
        bold: rAttr('b') === '1',
        italic: rAttr('i') === '1',
        underline: !!u && u !== 'none',
        color: colorOf(colorEl, theme),
        font: themeFont(face, theme),
        spacing: rAttr('spc') ? Number(rAttr('spc')) / 100 : 0,
      };
    });
    return {
      align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left',
      runs,
      bullet,
      indent: px(pAttr('marL')),
      lineHeight: lnPct ? (Number(lnPct) / 100000) * (1 - lnReduce) * 1.2 : null,
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
  const at = boxOf(grpXfrm) ?? { x: 0, y: 0, w: 0, h: 0, rot: 0 };
  const chOff = kid(grpXfrm, 'a:chOff'), chExt = kid(grpXfrm, 'a:chExt');
  const cx = px(chOff?.getAttribute('x')), cy = px(chOff?.getAttribute('y'));
  const sx = px(chExt?.getAttribute('cx')) ? at.w / px(chExt?.getAttribute('cx')) : 1;
  const sy = px(chExt?.getAttribute('cy')) ? at.h / px(chExt?.getAttribute('cy')) : 1;
  return items.map((it) => ({ ...it, x: at.x + (it.x - cx) * sx, y: at.y + (it.y - cy) * sy, w: it.w * sx, h: it.h * sy }));
}

interface ReadCtx {
  theme: Theme;
  media: (rId: string) => Promise<string | null>;
  /** null on a layout or master: their placeholders are templates, not content. */
  inherit: Inherit | null;
}

async function itemsOf(tree: Element, ctx: ReadCtx): Promise<DeckItem[]> {
  const { theme } = ctx;
  const out: DeckItem[] = [];
  for (const node of Array.from(tree.children)) {
    const ph = node.getElementsByTagName('p:ph')[0] ?? null;
    if (ph && !ctx.inherit) continue;
    const from = inheritedOf(ph, ctx.inherit);
    if (node.tagName === 'p:sp' || node.tagName === 'p:cxnSp') {
      const spPr = kid(node, 'p:spPr');
      const xfrm = kid(spPr, 'a:xfrm');
      const box = boxOf(xfrm) ?? from.map((p) => p.box).find(Boolean) ?? null;
      if (!box) continue;
      const prst = kid(spPr, 'a:prstGeom')?.getAttribute('prst') ?? 'rect';
      const geom = prst === 'line' || prst.startsWith('straightConnector') || node.tagName === 'p:cxnSp' ? 'line'
        : prst === 'ellipse' ? 'ellipse' : prst === 'roundRect' ? 'roundRect' : 'rect';
      const txBody = kid(node, 'p:txBody');
      out.push({
        kind: 'shape', geom, ...box,
        flipH: xfrm?.getAttribute('flipH') === '1', flipV: xfrm?.getAttribute('flipV') === '1',
        fill: geom === 'line' ? null : fillOf(spPr, theme) ?? from.map((p) => fillOf(p.spPr, theme)).find(Boolean) ?? null,
        stroke: strokeOf(spPr, theme, geom === 'line'),
        text: textOf(txBody, theme, styleChain(txBody, ph, ctx.inherit), from.map((p) => p.bodyPr).filter((e): e is Element => !!e)),
      });
    } else if (node.tagName === 'p:pic') {
      const blipFill = kid(node, 'p:blipFill');
      const rId = kid(blipFill, 'a:blip')?.getAttribute('r:embed');
      const src = rId ? await ctx.media(rId) : null;
      const box = boxOf(path(node, 'p:spPr', 'a:xfrm')) ?? from.map((p) => p.box).find(Boolean) ?? null;
      const rect = kid(blipFill, 'a:srcRect');
      const crop = (a: string) => Number(rect?.getAttribute(a) ?? 0) / 100000;
      if (src && box) out.push({ kind: 'image', src, ...box, crop: { l: crop('l'), t: crop('t'), r: crop('r'), b: crop('b') } });
    } else if (node.tagName === 'p:grpSp') {
      out.push(...place(await itemsOf(node, ctx), path(node, 'p:grpSpPr', 'a:xfrm')));
    } else if (node.tagName === 'p:graphicFrame') {
      const tbl = node.getElementsByTagName('a:tbl')[0];
      const box = boxOf(kid(node, 'p:xfrm')) ?? from.map((p) => p.box).find(Boolean) ?? null;
      if (!tbl || !box) continue;
      out.push({
        kind: 'table', ...box,
        cols: kids(kid(tbl, 'a:tblGrid'), 'a:gridCol').map((c) => px(c.getAttribute('w'))),
        rows: kids(tbl, 'a:tr').map((tr) => ({
          h: px(tr.getAttribute('h')),
          cells: kids(tr, 'a:tc').map((tc) => ({
            text: textOf(kid(tc, 'a:txBody'), theme, ctx.inherit?.defaultText ? [ctx.inherit.defaultText] : [], [])
              ?? { paras: [], anchor: 'top' as const, inset: [3.6, 7.2, 3.6, 7.2] as [number, number, number, number], vertical: false, wrap: true },
            fill: fillOf(kid(tc, 'a:tcPr'), theme),
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
  const zip = await JSZip.loadAsync(bytes);
  const cache = new Map<string, Promise<Document | null>>();
  const xml = (p: string) => {
    if (!cache.has(p)) {
      const f = zip.file(p);
      cache.set(p, f ? f.async('string').then((s) => new DOMParser().parseFromString(s, 'application/xml')) : Promise.resolve(null));
    }
    return cache.get(p)!;
  };
  const relsOf = async (p: string) => {
    const dir = p.slice(0, p.lastIndexOf('/'));
    const doc = await xml(`${dir}/_rels/${p.slice(dir.length + 1)}.rels`);
    const map = new Map<string, { target: string; type: string }>();
    for (const r of Array.from(doc?.getElementsByTagName('Relationship') ?? [])) {
      const target = r.getAttribute('Target') ?? '';
      map.set(r.getAttribute('Id') ?? '', {
        target: target.startsWith('/') ? target.slice(1) : new URL(target, `http://x/${dir}/`).pathname.slice(1),
        type: r.getAttribute('Type') ?? '',
      });
    }
    return map;
  };
  const relOfType = (rels: Map<string, { target: string; type: string }>, type: string) =>
    [...rels.values()].find((r) => r.type.endsWith(`/${type}`) || r.target.includes(`/${type}`))?.target ?? null;
  const mediaFor = (rels: Map<string, { target: string; type: string }>) => async (rId: string) => {
    const target = rels.get(rId)?.target;
    const f = target ? zip.file(target) : null;
    if (!f) return null;
    const ext = target!.split('.').pop()?.toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
    return `data:${mime};base64,${await f.async('base64')}`;
  };

  const pres = await xml('ppt/presentation.xml');
  const size = pres?.getElementsByTagName('p:sldSz')[0];
  const presRels = await relsOf('ppt/presentation.xml');
  const defaultText = pres?.getElementsByTagName('p:defaultTextStyle')[0] ?? null;

  const slidePaths = Array.from(pres?.getElementsByTagName('p:sldId') ?? [])
    .map((s) => presRels.get(s.getAttribute('r:id') ?? '')?.target)
    .filter((p): p is string => !!p);

  const themes = new Map<string, Theme>();
  const themeOf = async (masterPath: string): Promise<Theme> => {
    const themePath = relOfType(await relsOf(masterPath), 'theme') ?? relOfType(presRels, 'theme');
    const key = themePath ?? '';
    if (!themes.has(key)) {
      const doc = themePath ? await xml(themePath) : null;
      const colors: Record<string, string> = {};
      for (const c of Array.from(doc?.getElementsByTagName('a:clrScheme')[0]?.children ?? [])) {
        const v = c.children[0];
        colors[c.tagName.replace('a:', '')] = v?.getAttribute('val') ?? v?.getAttribute('lastClr') ?? '000000';
      }
      const face = (group: string) => {
        const g = doc?.getElementsByTagName(`a:${group}`)[0];
        return kid(g, 'a:ea')?.getAttribute('typeface') || kid(g, 'a:latin')?.getAttribute('typeface') || null;
      };
      themes.set(key, { colors, fonts: { major: face('majorFont'), minor: face('minorFont') } });
    }
    return themes.get(key)!;
  };

  const slides: DeckSlide[] = [];
  for (const p of slidePaths) {
    // Hand the page back between slides, so a long deck never freezes it.
    await new Promise((r) => setTimeout(r, 0));
    const doc = await xml(p);
    const cSld = doc?.getElementsByTagName('p:cSld')[0];
    const tree = kid(cSld, 'p:spTree');
    if (!doc || !tree) continue;
    const rels = await relsOf(p);
    const layoutPath = relOfType(rels, 'slideLayout');
    const layoutDoc = layoutPath ? await xml(layoutPath) : null;
    const layoutRels = layoutPath ? await relsOf(layoutPath) : new Map();
    const masterPath = layoutPath ? relOfType(layoutRels, 'slideMaster') : null;
    const masterDoc = masterPath ? await xml(masterPath) : null;
    const masterRels = masterPath ? await relsOf(masterPath) : new Map();
    const theme = masterPath ? await themeOf(masterPath) : await themeOf('ppt/presentation.xml');
    const layoutTree = path(layoutDoc?.documentElement, 'p:cSld', 'p:spTree');
    const masterTree = path(masterDoc?.documentElement, 'p:cSld', 'p:spTree');
    const txStyles = masterDoc?.getElementsByTagName('p:txStyles')[0];

    const inherit: Inherit = {
      layout: placeholdersOf(layoutTree), master: placeholdersOf(masterTree),
      txStyles: { title: kid(txStyles, 'p:titleStyle'), body: kid(txStyles, 'p:bodyStyle'), other: kid(txStyles, 'p:otherStyle') },
      defaultText,
    };

    // The background is the slide's, else its layout's, else its master's.
    const bgOf = async (root: Element | null | undefined, r: Map<string, { target: string; type: string }>) => {
      const bgPr = path(root, 'p:cSld', 'p:bg', 'p:bgPr');
      if (!bgPr) return null;
      const blip = path(bgPr, 'a:blipFill', 'a:blip')?.getAttribute('r:embed');
      if (blip) { const src = await mediaFor(r)(blip); return src ? `center / cover no-repeat url("${src}")` : null; }
      return fillOf(bgPr, theme);
    };
    const background = (await bgOf(doc.documentElement, rels)) ?? (await bgOf(layoutDoc?.documentElement, layoutRels)) ?? (await bgOf(masterDoc?.documentElement, masterRels));

    // The master's and layout's own shapes (logos, rules, bands) sit under
    // the slide's, unless the slide or its layout hides them.
    const showMaster = doc.documentElement.getAttribute('showMasterSp') !== '0' && layoutDoc?.documentElement.getAttribute('showMasterSp') !== '0';
    const items: DeckItem[] = [];
    if (showMaster && masterTree) items.push(...await itemsOf(masterTree, { theme, media: mediaFor(masterRels), inherit: null }));
    if (doc.documentElement.getAttribute('showMasterSp') !== '0' && layoutTree) items.push(...await itemsOf(layoutTree, { theme, media: mediaFor(layoutRels), inherit: null }));
    items.push(...await itemsOf(tree, { theme, media: mediaFor(rels), inherit }));
    slides.push({ background, items });
  }
  return { width: px(size?.getAttribute('cx')) || 960, height: px(size?.getAttribute('cy')) || 540, slides };
}

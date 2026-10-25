import FONTS from './fonts.json';

// =============================================================
// A Design — one artboard drawn in HTML, CSS and SVG.
//
// The format is the one the product it describes is built in, so a design is
// the real thing at its size, not a picture of it: AI writes and revises it,
// a developer copies it, and no tool owns it. It is static — no script runs —
// and it is drawn at a fixed size (`width` × `height` CSS pixels) and only
// scaled to fit, so it looks the same on every screen.
//
// What it may load is closed off: fonts come from the app's own set
// (fonts.json), images are embedded as data: URLs, and nothing reaches the
// network. `parseDesign` refuses anything else before it is saved or shown.
// =============================================================

export interface DesignFont { folder: string; package: string; family: string; kind: 'sans' | 'serif' | 'mono' }
export const DESIGN_FONTS = FONTS as DesignFont[];
const FAMILY_NAMES = new Set(DESIGN_FONTS.map(font => font.family));

export interface DesignSource {
  title: string;
  /** Artboard size in CSS pixels. */
  width: number;
  height: number;
  /** The artboard's own background, a CSS colour. */
  background: string;
  /** Families from DESIGN_FONTS the design uses. */
  fonts: string[];
  /** Markup for the artboard's contents — HTML with inline SVG. */
  html: string;
  css: string;
}

const ARTBOARD_MIN = 64;
const ARTBOARD_MAX = 4096;
const HTML_MAX = 400_000;
const CSS_MAX = 200_000;

const BLOCKED_TAGS = /<\s*\/?\s*(script|iframe|frame|frameset|object|embed|applet|base|meta|link|style|form|template|portal)\b/i;
const EVENT_HANDLER = /\son[a-z]+\s*=/i;
const SCRIPT_URL = /(java|vb)script\s*:/i;
/** A URL in markup that leaves the design: http(s), protocol-relative, or a file. */
const REMOTE_ATTR = /\s(?:src|href|xlink:href|srcset|poster|action|formaction|data)\s*=\s*["']?\s*(?:https?:|\/\/|file:|ftp:)/i;
/** CSS that loads or runs something: imports, remote url(), old IE expressions. */
const REMOTE_CSS = /@import|url\(\s*["']?\s*(?:https?:|\/\/|file:|ftp:)|expression\s*\(|-moz-binding|behavior\s*:/i;
/** A plain colour: hex, a keyword, or a colour function — never url() or more CSS. */
const COLOUR = /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|(?:rgba?|hsla?|oklch|oklab|lab|lch)\([0-9a-zA-Z.,%\s/-]{1,48}\))$/;

function size(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < ARTBOARD_MIN || value > ARTBOARD_MAX) {
    throw new Error(`The ${label} must be a whole number from ${ARTBOARD_MIN} to ${ARTBOARD_MAX}.`);
  }
  return value;
}

/** Checks a design before it is saved or shown; throws a sentence on refusal. */
export function parseDesign(raw: unknown): DesignSource {
  if (!raw || typeof raw !== 'object') throw new Error('The design is empty.');
  const v = raw as Record<string, unknown>;
  const title = typeof v.title === 'string' ? v.title.trim() : '';
  if (!title || title.length > 120) throw new Error('The design needs a title of up to 120 characters.');
  const html = typeof v.html === 'string' ? v.html : '';
  const css = typeof v.css === 'string' ? v.css : '';
  if (!html.trim()) throw new Error('The design is empty.');
  if (html.length > HTML_MAX || css.length > CSS_MAX) throw new Error('The design is too large.');
  if (BLOCKED_TAGS.test(html) || EVENT_HANDLER.test(html) || SCRIPT_URL.test(html)) {
    throw new Error('The design contains scripts or embedded pages, which designs cannot run.');
  }
  if (REMOTE_ATTR.test(html) || REMOTE_CSS.test(css) || SCRIPT_URL.test(css)) {
    throw new Error('The design loads something from outside. Embed images as data: URLs and use the app’s fonts.');
  }
  // design-lint-ignore — the artboard's own colour is the design's content, not app chrome.
  const background = typeof v.background === 'string' && COLOUR.test(v.background.trim()) ? v.background.trim() : '#ffffff';
  const fonts = Array.isArray(v.fonts) ? [...new Set(v.fonts.filter((f): f is string => typeof f === 'string' && FAMILY_NAMES.has(f)))] : [];
  return { title, width: size(v.width, 'width'), height: size(v.height, 'height'), background, fonts, html, css };
}

/** The page a design is drawn in: fixed size, the chosen fonts from the app,
 *  and a policy that lets nothing else load or run. `fontBase` is the app's
 *  origin (the frame itself has none). */
export function designDocument(design: DesignSource, fontBase: string): string {
  const base = fontBase.replace(/\/$/, '');
  const links = DESIGN_FONTS
    .filter(font => design.fonts.includes(font.family))
    .map(font => `<link rel="stylesheet" href="${base}/design-fonts/${font.folder}/font.css">`)
    .join('');
  const policy = `default-src 'none'; style-src 'unsafe-inline' ${base}; font-src ${base}; img-src data:; base-uri 'none'; form-action 'none'`;
  const css = design.css.replace(/<\/style/gi, '<\\/style');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">${links}`
    + `<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0}`
    + `body{width:${design.width}px;height:${design.height}px;overflow:hidden;background:${design.background};`
    + `-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}${css}</style></head>`
    + `<body>${design.html}</body></html>`;
}

/** The artboard as one block of markup a developer can paste: its CSS, then
 *  its HTML, inside an element of the design's size. */
export function designHandoff(design: DesignSource): string {
  const fonts = design.fonts.length ? `/* Fonts: ${design.fonts.join(', ')} */\n` : '';
  return `<style>\n${fonts}${design.css}\n</style>\n<div style="width:${design.width}px;height:${design.height}px;background:${design.background};overflow:hidden">\n${design.html}\n</div>\n`;
}

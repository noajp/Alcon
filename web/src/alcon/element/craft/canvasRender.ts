// Serialize a CraftDoc → standalone HTML for export / preview / Check-out.
// Each page becomes a fixed-size <section class="page"> with absolute-
// positioned children. Reads cleanly in a sandboxed iframe and prints
// page-per-page for PDF / PPTX-like output.

import type { CanvasItem, CraftDoc, CraftPage } from './canvasTypes';

export function renderDocToHtml(doc: CraftDoc): string {
  const pagesHtml = doc.pages.map(renderPage).join('\n');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html, body { margin: 0; padding: 0; background: #f4f4f5; font-family: system-ui, -apple-system, "Inter", sans-serif; color: #111; }
  .page {
    position: relative;
    margin: 24px auto;
    box-shadow: 0 6px 24px rgba(0,0,0,0.08);
    overflow: hidden;
  }
  .item { position: absolute; box-sizing: border-box; }
  .item.text { white-space: pre-wrap; word-break: break-word; }
  .item.image { object-fit: cover; }
  @media print {
    html, body { background: #ffffff; }
    .page { margin: 0; box-shadow: none; page-break-after: always; }
  }
</style>
</head>
<body>
${pagesHtml}
</body>
</html>`;
}

// Wrap a flow-HTML document body (from DocEditor) in a printable shell
// with the navy Documentation band on top. The body is the innerHTML the
// user authored — we never sanitize it in this layer; it's contained in
// a sandboxed iframe everywhere it's rendered.
export function renderDocFlowToHtml({
  body, title, elementName,
}: {
  body: string;
  title: string;
  elementName?: string;
}): string {
  const meta = elementName
    ? `${escapeHtml(elementName)}`
    : '';
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; padding: 0; background: #f4f4f5; font-family: system-ui, -apple-system, "Inter", sans-serif; color: #111; }
  .doc-band {
    height: 56px;
    background: linear-gradient(90deg, #0F2A52 0%, #1B4FA7 100%);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 32px;
    font-size: 14px;
    font-weight: 600;
  }
  .doc-band .meta { font-weight: 400; opacity: 0.85; font-size: 12px; }
  .doc-paper { max-width: 760px; margin: 32px auto; padding: 64px 72px; background: #fff; border-radius: 4px; box-shadow: 0 6px 24px rgba(0,0,0,0.08); line-height: 1.6; font-size: 16px; }
  .doc-paper h1 { font-size: 28px; font-weight: 700; margin: 24px 0 12px; line-height: 1.2; }
  .doc-paper h2 { font-size: 22px; font-weight: 700; margin: 20px 0 10px; line-height: 1.25; }
  .doc-paper h3 { font-size: 18px; font-weight: 600; margin: 18px 0 8px; line-height: 1.3; }
  .doc-paper p  { margin: 8px 0; }
  .doc-paper ul, .doc-paper ol { padding-left: 24px; margin: 8px 0; }
  .doc-paper li { margin: 4px 0; }
  .doc-paper blockquote { border-left: 3px solid #d4d4d8; padding-left: 12px; color: #52525b; margin: 12px 0; font-style: italic; }
  .doc-paper pre { background: #f4f4f5; padding: 12px 14px; border-radius: 6px; overflow-x: auto; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; }
  .doc-paper code { background: #f4f4f5; padding: 1px 5px; border-radius: 3px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.9em; }
  .doc-paper a { color: #1B4FA7; text-decoration: underline; }
  .doc-paper img { max-width: 100%; height: auto; border-radius: 4px; }
  .doc-paper table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  .doc-paper th, .doc-paper td { border: 1px solid #e4e4e7; padding: 8px 10px; text-align: left; }
  .doc-paper th { background: #fafafa; font-weight: 600; }
  @media print {
    html, body { background: #ffffff; }
    .doc-paper { margin: 0; box-shadow: none; max-width: none; padding: 0; }
    .doc-band { display: none; }
  }
</style>
</head>
<body>
<div class="doc-band">
  <span>${escapeHtml(title)}</span>
  <span class="meta">${meta}</span>
</div>
<article class="doc-paper">
${body || '<p><em>(no content)</em></p>'}
</article>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderPage(page: CraftPage): string {
  const items = page.items.map(renderItem).join('\n');
  return `<section class="page" style="width:${page.width}px;height:${page.height}px;background:${escAttr(page.background)};">
${items}
</section>`;
}

function renderItem(item: CanvasItem): string {
  const base = `left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;${
    item.rotation ? `transform:rotate(${item.rotation}deg);` : ''
  }`;
  switch (item.type) {
    case 'text': {
      const css = `${base}font-size:${item.fontSize}px;font-weight:${item.fontWeight};color:${escAttr(
        item.color
      )};text-align:${item.align};line-height:1.4;${
        item.fontFamily ? `font-family:${escAttr(item.fontFamily)};` : ''
      }`;
      return `<div class="item text" style="${css}">${escHtml(item.text)}</div>`;
    }
    case 'rect': {
      const css = `${base}background:${escAttr(item.fill)};border:${item.strokeWidth}px solid ${escAttr(
        item.stroke
      )};border-radius:${item.radius}px;`;
      return `<div class="item rect" style="${css}"></div>`;
    }
    case 'ellipse': {
      const css = `${base}background:${escAttr(item.fill)};border:${item.strokeWidth}px solid ${escAttr(
        item.stroke
      )};border-radius:9999px;`;
      return `<div class="item ellipse" style="${css}"></div>`;
    }
    case 'image': {
      const css = `${base}object-fit:${item.fit};`;
      return `<img class="item image" src="${escAttr(item.src)}" style="${css}" alt="" />`;
    }
  }
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />');
}
function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

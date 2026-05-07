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

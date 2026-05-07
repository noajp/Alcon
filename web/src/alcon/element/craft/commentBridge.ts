// Comment-mode bridge between the parent workspace and the sandboxed
// preview iframe.
//
// On enable: we inject a tiny script via a transformed copy of the model's
// HTML (the original draft is left untouched). The script attaches a
// click handler that captures the clicked element's CSS selector + outer
// HTML snippet, then posts it back via window.parent.postMessage. The
// parent listens, places a pin marker in the workspace UI, and on the
// next chat send injects "edit only this region" context into the prompt.

export interface CommentPin {
  id: string;
  selector: string;
  /** Up to ~280 chars of the clicked element's outerHTML — context for the model. */
  snippet: string;
  note: string;
  created_at: string;
}

const BRIDGE_SCRIPT = `
<script>
(function () {
  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + el.id;
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      var part = node.tagName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        var cls = node.className.trim().split(/\\s+/).slice(0, 2).join('.');
        if (cls) part += '.' + cls;
      }
      var parent = node.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (siblings.length > 1) {
          part += ':nth-of-type(' + (Array.prototype.indexOf.call(siblings, node) + 1) + ')';
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }
  document.documentElement.style.cursor = 'crosshair';
  document.addEventListener('mouseover', function (e) {
    if (e.target && e.target.style) e.target.style.outline = '2px solid #ef4444';
  }, true);
  document.addEventListener('mouseout', function (e) {
    if (e.target && e.target.style) e.target.style.outline = '';
  }, true);
  document.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    var snippet = (el.outerHTML || '').slice(0, 280);
    var selector = selectorFor(el);
    window.parent.postMessage({ type: 'craft:comment-pin', selector: selector, snippet: snippet }, '*');
  }, true);
})();
</script>
`;

/**
 * Returns a copy of the HTML with the bridge script appended just before
 * </body>. Falls back to appending at the very end when no </body> exists.
 */
export function withBridge(html: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, BRIDGE_SCRIPT + '</body>');
  return html + BRIDGE_SCRIPT;
}

/**
 * Build the augmented user prompt that asks the model to rewrite only the
 * pinned regions. The original prompt comes through verbatim so the user
 * can still describe what they want.
 */
export function buildPinnedPrompt(rawPrompt: string, pins: CommentPin[]): string {
  if (pins.length === 0) return rawPrompt;
  const lines: string[] = [
    rawPrompt,
    '',
    '# 編集対象 (この範囲だけ書き換えてください。他は維持)',
  ];
  pins.forEach((pin, i) => {
    lines.push(`\n## ピン ${i + 1}`);
    lines.push(`- セレクタ: \`${pin.selector}\``);
    if (pin.note.trim()) lines.push(`- メモ: ${pin.note.trim()}`);
    lines.push('- 現在の HTML スニペット:');
    lines.push('```html');
    lines.push(pin.snippet);
    lines.push('```');
  });
  return lines.join('\n');
}

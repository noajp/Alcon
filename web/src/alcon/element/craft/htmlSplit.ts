// Split a single-file HTML string into pseudo "files" so we can show them
// as tabs in the workspace's multi-file panel. The split is read-only —
// the model still produces (and overwrites) the merged single-file HTML.
//
// The HTML contract bans <script>, so the script bucket is informational
// only; if the model ever leaks one we still expose it for debugging.

export interface CraftFile {
  name: string;
  language: 'html' | 'css' | 'javascript';
  content: string;
}

export function splitHtml(full: string): CraftFile[] {
  const files: CraftFile[] = [];

  // Pull every <style>...</style> block (concat in document order).
  const styles: string[] = [];
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRegex.exec(full)) !== null) styles.push(m[1].trim());

  // Pull every <script>...</script> block.
  const scripts: string[] = [];
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = scriptRegex.exec(full)) !== null) scripts.push(m[1].trim());

  // Body content (between <body> tags) — fall back to the full string if
  // the model omits the wrapper.
  const bodyMatch = full.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1].trim() : full.trim();

  files.push({ name: 'index.html', language: 'html', content: full });
  if (styles.length > 0) {
    files.push({
      name: 'styles.css',
      language: 'css',
      content: styles.join('\n\n/* --- */\n\n'),
    });
  }
  if (scripts.length > 0) {
    files.push({
      name: 'app.js',
      language: 'javascript',
      content: scripts.join('\n\n// --- \n\n'),
    });
  }
  files.push({ name: 'body.html', language: 'html', content: body });

  return files;
}

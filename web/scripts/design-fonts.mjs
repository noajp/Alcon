// Copies the fonts a Design can use into public/design-fonts/, one folder per
// family with its woff2 files and a font.css that names the family as designs
// write it ('Inter', not 'Inter Variable'). Designs render in a sandboxed
// frame that may load fonts only from the app itself, so the app holds them —
// no third-party font service sees who opens a design.
//
// The family list is src/Function/widget/design/fonts.json, which the app
// reads too. Generated output is not committed (.gitignore).
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, 'public', 'design-fonts');

const FAMILIES = JSON.parse(readFileSync(join(web, 'src', 'Function', 'widget', 'design', 'fonts.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
for (const { folder, package: pkg, family } of FAMILIES) {
  const from = join(web, 'node_modules', pkg);
  const css = readFileSync(join(from, 'index.css'), 'utf8');
  const dest = join(out, folder);
  mkdirSync(dest, { recursive: true });
  const files = [...css.matchAll(/url\(\.\/files\/([^)]+)\)/g)].map((m) => m[1]);
  for (const file of new Set(files)) copyFileSync(join(from, 'files', file), join(dest, file));
  const renamed = css
    .replace(/font-family: '[^']+';/g, `font-family: '${family}';`)
    .replace(/url\(\.\/files\//g, 'url(./');
  writeFileSync(join(dest, 'font.css'), renamed);
}
console.log(`design-fonts: ${FAMILIES.length} families → public/design-fonts`);

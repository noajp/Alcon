// Copies the homepage (../website) into public/homepage/, where the app serves
// it at /homepage. A signed-out visitor to / is sent there.
//
// website/ links its images as assets/…; served from /homepage they become
// /homepage/assets/…. Generated output is not committed (.gitignore).
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(web, '..', 'website');
const out = join(web, 'public', 'homepage');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });

const html = readFileSync(join(from, 'index.html'), 'utf8').replace(/(src|href)="assets\//g, '$1="/homepage/assets/');
writeFileSync(join(out, 'index.html'), html);
for (const file of readdirSync(join(from, 'assets'))) copyFileSync(join(from, 'assets', file), join(out, 'assets', file));

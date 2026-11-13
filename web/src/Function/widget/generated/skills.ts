import { LIBRARY_URL } from './model';

// What a Space's canvases can draw with. Two kinds, both imported by pasting
// an address or a name:
//  - a library: one script the canvas loads into its sandbox (the host
//    fetches it; the canvas itself has no network), with notes for the AI
//    on how to use it;
//  - a guide: a skill document (SKILL.md, a skill's JSON) the AI reads
//    when it writes a canvas.
// Things that only run outside a browser (a renderer, a desktop app, a
// Python package) cannot be loaded into a canvas, and importing one says so.

export type SkillKind = 'guide' | 'library';
export interface SkillDraft { kind: SkillKind; name: string; body: string; url: string | null }

interface KnownLibrary { name: string; match: string[]; url: string; notes: string }

/** Libraries known to ship one self-contained browser script. */
export const KNOWN_LIBRARIES: KnownLibrary[] = [
  { name: 'Three.js', match: ['three', 'three.js', 'mrdoob/three.js'], url: 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js', notes: 'Global THREE (r160). 3D scenes with WebGLRenderer on a canvas element of a fixed pixel height; no loaders for remote files (no network) — build geometry in code, textures from canvas or data URLs. Stop the animation loop when the page is hidden.' },
  { name: 'postprocessing', match: ['postprocessing', 'pmndrs/postprocessing'], url: 'https://cdn.jsdelivr.net/npm/postprocessing@6.33.4/build/postprocessing.min.js', notes: 'Global POSTPROCESSING; needs Three.js listed before it. EffectComposer, RenderPass, EffectPass with BloomEffect, DepthOfFieldEffect and others.' },
  { name: 'Anime.js', match: ['anime', 'animejs', 'anime.js', 'juliangarnier/anime'], url: 'https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js', notes: 'Global anime (v3). anime({targets, ...}) and anime.timeline() for choreographed sequences on DOM and SVG.' },
  { name: 'Motion', match: ['motion', 'motiondivision/motion', 'framer-motion'], url: 'https://cdn.jsdelivr.net/npm/motion@10.18.0/dist/motion.min.js', notes: 'Global Motion (Motion One v10): Motion.animate(el, keyframes, options), Motion.timeline, Motion.stagger, Motion.spring, Motion.inView. This is the vanilla API, not the React components.' },
  { name: 'Lottie', match: ['lottie', 'lottie-web', 'airbnb/lottie-web'], url: 'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js', notes: 'Global lottie. lottie.loadAnimation({container, renderer:"svg", loop, autoplay, animationData}) — animationData must be a JSON object written in the code (no network to fetch a file).' },
  { name: 'Tweakpane', match: ['tweakpane', 'cocopon/tweakpane'], url: 'https://cdn.jsdelivr.net/npm/tweakpane@3.1.10/dist/tweakpane.min.js', notes: 'Global Tweakpane (v3). new Tweakpane.Pane({container}) with addInput(params, key, options) for live controls; place it in a container element, not fixed to the viewport.' },
  { name: 'D3', match: ['d3', 'd3/d3'], url: 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js', notes: 'Global d3 (v7): scales, shapes, layouts, hierarchy, force simulation, geo projections.' },
  { name: 'Chart.js', match: ['chart.js', 'chartjs', 'chartjs/chart.js'], url: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js', notes: 'Global Chart (v4). new Chart(canvasElement, {type, data, options}); give the canvas a wrapper of a fixed height.' },
  { name: 'GSAP', match: ['gsap', 'greensock/gsap'], url: 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js', notes: 'Global gsap: gsap.to/from/fromTo and gsap.timeline() for sequenced animation.' },
  { name: 'Matter.js', match: ['matter', 'matter-js', 'liabru/matter-js'], url: 'https://cdn.jsdelivr.net/npm/matter-js@0.19.0/build/matter.min.js', notes: 'Global Matter: 2D rigid-body physics (Engine, Render, Runner, Bodies, Composite, Constraint, Mouse).' },
  { name: 'Rough.js', match: ['rough', 'roughjs', 'rough-stuff/rough'], url: 'https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js', notes: 'Global rough: hand-drawn looking shapes on canvas (rough.canvas(el)) or SVG (rough.svg(el)).' },
  { name: 'p5.js', match: ['p5', 'p5.js', 'processing/p5.js'], url: 'https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/p5.min.js', notes: 'Global p5, in instance mode only: new p5(sketch, containerElement) with a canvas of a fixed size.' },
];

/** Names that cannot run inside a canvas, and why (shown to the person importing). */
const OUTSIDE: { match: string[]; why: string }[] = [
  { match: ['remotion-dev/remotion', 'remotion'], why: 'Remotion renders video with a React build step and a renderer process; a canvas runs one page of browser code. For motion on a canvas, import Anime.js, Motion, GSAP or Three.js.' },
  { match: ['manimcommunity/manim', 'manim'], why: 'Manim is a Python program that renders video files.' },
  { match: ['ahujasid/mcp-for-blender', 'blender-mcp', 'blender'], why: 'Blender is a desktop application.' },
  { match: ['comfy-org/comfyui', 'comfyui'], why: 'ComfyUI is a server that runs image models.' },
  { match: ['cosyvoice'], why: 'CosyVoice is a Python speech model.' },
  { match: ['librosa/librosa', 'librosa'], why: 'librosa is a Python package.' },
  { match: ['m-bain/whisperx', 'whisperx'], why: 'WhisperX is a Python speech model.' },
  { match: ['obsproject/obs-studio', 'obs'], why: 'OBS Studio is a desktop application.' },
  { match: ['mifi/lossless-cut', 'losslesscut'], why: 'LosslessCut is a desktop application.' },
  { match: ['ffmpeg/ffmpeg', 'ffmpeg'], why: 'FFmpeg is a command-line program.' },
  { match: ['jrouwe/joltphysics', 'jolt'], why: 'Jolt Physics is a C++ engine with no single browser script. For physics on a canvas, import Matter.js.' },
  { match: ['gkjohnson/three-gpu-pathtracer', 'three-gpu-pathtracer'], why: 'It ships as modules that need a build step, not one browser script.' },
];

export class SkillImportError extends Error {}

const GITHUB = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:blob|tree)\/([^/]+)\/(.+?))?\/?(?:[?#].*)?$/i;
const MAX_GUIDE = 30000;
const SKILL_FILE = /(^|\/)(SKILL\.md|skill[\w.-]*\.json|[\w.-]+\.skill\.json)$/i;

/** Pure. The key a name or address is matched by: `owner/repo` for GitHub, the bare word otherwise. */
export function importKey(input: string): string {
  const text = input.trim();
  const repo = GITHUB.exec(text);
  if (repo) return `${repo[1]}/${repo[2]}`.toLowerCase();
  return text.replace(/^https?:\/\/(www\.)?npmjs\.com\/package\//i, '').replace(/\/$/, '').toLowerCase();
}

/** Pure. A known library for this name or address, or the reason it cannot run on a canvas. */
export function matchKnown(input: string): { library: KnownLibrary } | { outside: string } | null {
  const key = importKey(input);
  const bare = key.includes('/') ? key.split('/')[1] : key;
  const hit = (names: string[]) => names.includes(key) || names.includes(bare);
  const outside = OUTSIDE.find((o) => hit(o.match));
  if (outside && !KNOWN_LIBRARIES.some((l) => l.match.includes(key))) return { outside: outside.why };
  const library = KNOWN_LIBRARIES.find((l) => hit(l.match));
  return library ? { library } : null;
}

/** Pure. A guide's name from its text: the frontmatter or JSON `name`, else the fallback. */
export function guideName(text: string, fallback: string): string {
  const front = /^---\s*\n([\s\S]*?)\n---/.exec(text)?.[1];
  const named = front ? /^name:\s*["']?(.+?)["']?\s*$/m.exec(front)?.[1] : null;
  if (named) return named.slice(0, 80);
  if (text.trimStart().startsWith('{')) {
    try { const v = JSON.parse(text) as { name?: unknown; title?: unknown }; const n = typeof v.name === 'string' ? v.name : typeof v.title === 'string' ? v.title : null; if (n) return n.slice(0, 80); } catch { /* not JSON */ }
  }
  return fallback.slice(0, 80);
}

const guide = (text: string, fallback: string, url: string | null): SkillDraft =>
  ({ kind: 'guide', name: guideName(text, fallback), body: text.slice(0, MAX_GUIDE), url });

async function text(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new SkillImportError(`Could not read ${url} (${res.status}).`);
  return res.text();
}

/**
 * What an address, a name or pasted text imports as: one library, or the
 * skill documents found (a repository can hold several — the caller lets
 * the person choose).
 */
export async function resolveSkillImport(input: string): Promise<SkillDraft[]> {
  const raw = input.trim();
  if (!raw) throw new SkillImportError('Paste an address, a library name or a skill document.');
  // Pasted text: a document, not a name or an address.
  if (/\n/.test(raw) || (raw.length > 200 && !/^https?:\/\//i.test(raw))) return [guide(raw, raw.split('\n')[0].replace(/^[#\s-]+/, '') || 'Skill', null)];

  const known = matchKnown(raw);
  if (known && 'outside' in known) throw new SkillImportError(known.outside);
  if (known) return [{ kind: 'library', name: known.library.name, body: known.library.notes, url: known.library.url }];

  if (LIBRARY_URL.test(raw)) return [{ kind: 'library', name: raw.split('/npm/')[1].split('@')[0] || 'Library', body: '', url: raw }];

  const repo = GITHUB.exec(raw);
  if (repo) {
    const [, owner, name, ref, path] = repo;
    if (path && /\.(md|json|txt)$/i.test(path)) {
      const url = `https://raw.githubusercontent.com/${owner}/${name}/${ref}/${path}`;
      return [guide(await text(url), path.split('/').slice(-2, -1)[0] || name, raw)];
    }
    const tree = await fetch(`https://api.github.com/repos/${owner}/${name}/git/trees/${ref ?? 'HEAD'}?recursive=1`);
    if (!tree.ok) throw new SkillImportError(tree.status === 404 ? 'That repository was not found (or is private).' : `GitHub did not answer (${tree.status}). Try again in a minute.`);
    const files = ((await tree.json()) as { tree?: { path: string; type: string }[] }).tree ?? [];
    const under = path ? `${path.replace(/\/$/, '')}/` : '';
    const found = files.filter((f) => f.type === 'blob' && f.path.startsWith(under) && SKILL_FILE.test(f.path)).slice(0, 40);
    if (!found.length) throw new SkillImportError('No skill document (SKILL.md or a skill JSON) was found there, and it is not a library a canvas can load. Paste the document itself, or the address of the file.');
    const rawOf = (p: string) => `https://raw.githubusercontent.com/${owner}/${name}/${ref ?? 'HEAD'}/${p}`;
    return Promise.all(found.map(async (f) => {
      const folder = f.path.split('/').slice(-2, -1)[0];
      const file = f.path.split('/').pop()!.replace(/\.(md|json)$/i, '');
      let body = await text(rawOf(f.path));
      // A SKILL.md usually points at reference documents beside it: they
      // come along (while there is room), so the skill reads whole.
      if (/SKILL\.md$/i.test(f.path)) {
        const dir = f.path.slice(0, -'SKILL.md'.length);
        const others = found.filter((o) => o !== f && o.path.startsWith(dir) && dir !== '').length;
        const refs = files.filter((o) => o.type === 'blob' && o.path !== f.path && o.path.startsWith(dir) && /\.md$/i.test(o.path)
          && !/(^|\/)(README|LICENSE|CHANGELOG|CONTRIBUTING|SKILL)\.md$/i.test(o.path) && (dir !== '' || found.length === 1) && !others).slice(0, 8);
        for (const r of refs) {
          if (body.length >= MAX_GUIDE - 500) break;
          try { body += `\n\n----- ${r.path.slice(dir.length)} -----\n${await text(rawOf(r.path))}`; } catch { /* a reference that cannot be read is left out */ }
        }
      }
      return guide(body, /^skill$/i.test(file) ? folder || name : file, `https://github.com/${owner}/${name}/blob/${ref ?? 'HEAD'}/${f.path}`);
    }));
  }
  if (/^https?:\/\//i.test(raw)) return [guide(await text(raw), raw.split('/').pop() || 'Skill', raw)];
  throw new SkillImportError('Not a library a canvas can load. Paste a GitHub address that holds a skill document, a jsDelivr script address with its version, or the document itself.');
}

const codeCache = new Map<string, Promise<string>>();
/** A library's code, fetched once per page (the address is pinned, so it never changes). */
export function libraryCode(url: string): Promise<string> {
  if (!LIBRARY_URL.test(url)) return Promise.reject(new Error('This library address is not allowed.'));
  let hit = codeCache.get(url);
  if (!hit) {
    hit = fetch(url).then((res) => { if (!res.ok) throw new Error(`Could not load a library (${res.status}).`); return res.text(); });
    hit.catch(() => codeCache.delete(url));
    codeCache.set(url, hit);
  }
  return hit;
}

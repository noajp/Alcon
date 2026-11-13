import { describe, expect, it } from 'vitest';
import { KNOWN_LIBRARIES, guideName, importKey, matchKnown } from '@/Function/widget/generated/skills';
import { LIBRARY_URL, parseAppSource } from '@/Function/widget/generated/model';
import { appDocument } from '@/Function/widget/generated/runtime';

const base = { title: 'x', html: '<div></div>', css: '', js: '' };

describe('canvas skills', () => {
  it('reads a GitHub address as owner/repo and a bare name as itself', () => {
    expect(importKey('https://github.com/mrdoob/three.js')).toBe('mrdoob/three.js');
    expect(importKey('https://github.com/juliangarnier/anime/tree/master/src')).toBe('juliangarnier/anime');
    expect(importKey(' Tweakpane ')).toBe('tweakpane');
  });

  it('finds a known library by its repository or its name', () => {
    const three = matchKnown('https://github.com/mrdoob/three.js');
    expect(three && 'library' in three && three.library.name).toBe('Three.js');
    const anime = matchKnown('animejs');
    expect(anime && 'library' in anime && anime.library.name).toBe('Anime.js');
  });

  it('says why something that runs outside a browser cannot be loaded', () => {
    for (const address of ['https://github.com/remotion-dev/remotion', 'https://github.com/FFmpeg/FFmpeg', 'https://github.com/ManimCommunity/manim']) {
      const hit = matchKnown(address);
      expect(hit && 'outside' in hit, address).toBe(true);
    }
    // A repository of skill documents is neither: it is read for its documents.
    expect(matchKnown('https://github.com/remotion-dev/skills')).toBeNull();
    expect(matchKnown('https://github.com/carnot-tech/jinba-consulting-pptx-skill')).toBeNull();
  });

  it('every known library is at an address a canvas may load', () => {
    for (const lib of KNOWN_LIBRARIES) expect(LIBRARY_URL.test(lib.url), lib.name).toBe(true);
  });

  it('names a guide from its frontmatter or its JSON, else from where it was found', () => {
    expect(guideName('---\nname: consulting-pptx\ndescription: x\n---\n# Body', 'fallback')).toBe('consulting-pptx');
    expect(guideName('{"name":"Brand book","steps":[]}', 'fallback')).toBe('Brand book');
    expect(guideName('# Just text', 'folder-name')).toBe('folder-name');
  });

  it('an app may list only pinned jsDelivr scripts, and few of them', () => {
    const ok = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
    expect(parseAppSource({ ...base, libraries: [ok] }).libraries).toEqual([ok]);
    expect(parseAppSource({ ...base, libraries: [] }).libraries).toBeUndefined();
    for (const bad of ['https://evil.example/x.js', 'https://cdn.jsdelivr.net/npm/three/build/three.min.js', 'https://cdn.jsdelivr.net/npm/three@latest/build/three.min.js', 'https://cdn.jsdelivr.net/gh/a/b@1.0.0/x.js']) {
      expect(() => parseAppSource({ ...base, libraries: [bad] }), bad).toThrow();
    }
    expect(() => parseAppSource({ ...base, libraries: Array(7).fill(ok) })).toThrow();
  });

  it('library code is placed before the app and cannot close its script', () => {
    const html = appDocument(base, {}, { objectId: 'o', objectName: '' }, 'c', {}, ['window.LIB=1;"</script><script>evil()"']);
    expect(html.indexOf('window.LIB=1')).toBeLessThan(html.indexOf('const channel='));
    expect(html).not.toContain('</script><script>evil()');
  });
});

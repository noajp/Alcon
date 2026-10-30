import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN_FONTS, designDocument, designHandoff, parseDesign } from '@/Function/widget/design/model';

const base = { title: 'Pricing card', width: 800, height: 600, background: '#0f1011', fonts: ['Inter'], html: '<div class="card"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg></div>', css: '.card{padding:24px}' };

describe('parseDesign', () => {
  it('accepts a static HTML/SVG artboard', () => {
    expect(parseDesign(base)).toEqual(base);
  });
  it('keeps only fonts the app holds, once each', () => {
    expect(parseDesign({ ...base, fonts: ['Inter', 'Comic Sans', 'Inter', 'Noto Sans JP'] }).fonts).toEqual(['Inter', 'Noto Sans JP']);
  });
  it('falls back to white for a background that is not a plain colour', () => {
    expect(parseDesign({ ...base, background: 'url(x)' }).background).toBe('#ffffff');
  });
  it('refuses scripts, event handlers and embedded pages', () => {
    for (const html of ['<script>1</script>', '<img src="data:," onerror="x()">', '<a href="javascript:x()">', '<iframe></iframe>', '<style>a{}</style>', '<link rel="x">']) {
      expect(() => parseDesign({ ...base, html })).toThrow(/scripts or embedded pages/);
    }
  });
  it('refuses anything that reaches outside the design', () => {
    expect(() => parseDesign({ ...base, html: '<img src="https://x.test/a.png">' })).toThrow(/outside/);
    expect(() => parseDesign({ ...base, html: '<image href="//x.test/a.png"/>' })).toThrow(/outside/);
    expect(() => parseDesign({ ...base, css: '@import "x.css";' })).toThrow(/outside/);
    expect(() => parseDesign({ ...base, css: 'a{background:url(https://x.test/a.png)}' })).toThrow(/outside/);
  });
  it('allows embedded data: images', () => {
    expect(() => parseDesign({ ...base, html: '<img src="data:image/png;base64,AAAA">', css: 'a{background:url(data:image/svg+xml;utf8,<svg/>)}' })).not.toThrow();
  });
  it('holds the artboard to a sane size', () => {
    expect(() => parseDesign({ ...base, width: 10 })).toThrow(/width/);
    expect(() => parseDesign({ ...base, height: 5000 })).toThrow(/height/);
    expect(() => parseDesign({ ...base, width: 100.5 })).toThrow(/width/);
  });
});

describe('designDocument', () => {
  const doc = designDocument(parseDesign({ ...base, css: '.a{}</style><script>x</script>' }), 'https://app.test/');
  it('lets nothing run and loads fonts only from the app', () => {
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('font-src https://app.test;');
    expect(doc).not.toMatch(/script-src/);
    expect(doc).toContain('href="https://app.test/design-fonts/inter/font.css"');
  });
  it('keeps the CSS inside its style element', () => {
    expect(doc).not.toContain('</style><script>');
  });
  it('draws at the artboard size', () => {
    expect(doc).toContain('width:800px;height:600px');
  });
});

describe('fonts', () => {
  it('names each family once', () => {
    expect(new Set(DESIGN_FONTS.map(f => f.family)).size).toBe(DESIGN_FONTS.length);
  });
  it('offers the generator exactly the fonts the app holds', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'supabase', 'functions', 'generate-design', 'index.ts'), 'utf8');
    const listed = JSON.parse(source.match(/const FONTS = (\[[^\]]+\])/)![1].replace(/'/g, '"'));
    expect(listed).toEqual(DESIGN_FONTS.map(f => f.family));
  });
  it('hands off the design with its fonts named', () => {
    expect(designHandoff(parseDesign(base))).toContain('/* Fonts: Inter */');
  });
});

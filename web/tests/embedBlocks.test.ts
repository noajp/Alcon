// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { embedSource, parseEmbed } from '@/Function/notebook/editor/embedBlocks';
import { htmlToMarkdown, markdownToHtml } from '@/Function/shared/markdownHtml';

describe('embed blocks', () => {
  it('reads a spec and refuses what is not one', () => {
    expect(parseEmbed('{"view":"gantt"}')).toEqual({ view: 'gantt' });
    expect(parseEmbed(' {"view":"elements","limit":5} ')).toEqual({ view: 'elements', limit: 5 });
    expect(parseEmbed('not json')).toBeNull();
    expect(parseEmbed('{"kind":"x"}')).toBeNull();
    expect(parseEmbed('[1]')).toBeNull();
    expect(parseEmbed('')).toBeNull();
  });

  it('survives the Markdown round trip as an ```clayware block', () => {
    const md = `Before.\n\n\`\`\`clayware\n${embedSource({ view: 'progress' })}\n\`\`\`\n\nAfter.`;
    const html = markdownToHtml(md);
    expect(html).toContain('<pre data-lang="clayware">');
    const back = htmlToMarkdown(html);
    expect(back).toContain('```clayware');
    expect(parseEmbed(back.split('```clayware')[1].split('```')[0])).toEqual({ view: 'progress' });
  });
});

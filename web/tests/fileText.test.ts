// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fileText } from '@/Function/office/fileText';
import { googleSheetsWorkbook, powerPointDeck, wordDocument } from './fixtures/officeFixtures';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('fileText', () => {
  it('reads Word paragraphs, slide lines and workbook cells', async () => {
    expect(await fileText(await wordDocument(), 'a.docx', null)).toContain('料金を改定する');
    expect(await fileText(await powerPointDeck(), 'a.pptx', null)).toContain('新規顧客の獲得');
    const sheet = await fileText(await googleSheetsWorkbook(), 'a.xlsx', null);
    expect(sheet).toContain('運用パフォーマンス');
    expect(sheet).toContain('8月');
  });

  it('reads text files and a page\'s visible words, not its scripts', async () => {
    expect(await fileText(bytes('a,b\n1,2'), 'x.csv', 'text/csv')).toBe('a,b\n1,2');
    expect(await fileText(bytes('<html><head><style>p{}</style></head><body><p>見える</p><script>hidden()</script></body></html>'), 'p.html', 'text/html')).toBe('見える');
  });

  it('has nothing to say about an image', async () => {
    expect(await fileText(bytes('x'), 'a.png', 'image/png')).toBeNull();
  });
});

describe('fileText normalization', () => {
  it('turns look-alike characters into the ones people type', async () => {
    expect(await fileText(new TextEncoder().encode('⾃動化　ＡＢＣ').buffer as ArrayBuffer, 'a.txt', 'text/plain')).toBe('自動化 ABC');
  });
});

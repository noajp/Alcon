// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readDeck } from '@/Function/office/deckLayout';
import { readWorkbook } from '@/Function/office/sheetLayout';
import { readDocLayout, type DocPara, type DocTable } from '@/Function/office/docLayout';
import { googleSheetsWorkbook, powerPointDeck, wordDocument } from './fixtures/officeFixtures';

// The previews are deterministic: the same file reads to the same layout on
// every run. Each sample is read whole and compared with its snapshot, so a
// change to a reader that moves anything in another kind of file shows up
// here — review the snapshot diff, and update it (vitest -u) only when the
// new layout is the intended one. The spot checks name what matters most.

describe('golden previews', () => {
  it('a PowerPoint-made deck', async () => {
    const deck = await readDeck(await powerPointDeck());
    expect(deck).toMatchSnapshot();
    const [cover, content] = deck.slides;
    const title = cover.items.find((i) => i.kind === 'shape' && i.text?.paras[0]?.runs[0]?.text === '2026年度 事業計画');
    expect(title).toMatchObject({ x: 160, y: expect.closeTo(117.83, 1), text: { anchor: 'bottom', paras: [{ align: 'center', runs: [{ size: 60, color: '#0e2841', font: '游ゴシック Light' }] }] } });
    expect(cover.items[0]).toMatchObject({ fill: 'linear-gradient(90deg, #156082 0%, #e97132 100%)' });
    const body = content.items.find((i) => i.kind === 'shape' && i.text?.paras[0]?.runs[0]?.text === '新規顧客の獲得');
    expect(body).toMatchObject({ text: { paras: [{ bullet: '•', runs: [{ size: expect.closeTo(25.9, 5) }] }, { bullet: '–', indent: 72 }] } });
  });

  it('a Google Sheets workbook', async () => {
    const sheets = await readWorkbook(await googleSheetsWorkbook());
    expect(sheets).toMatchSnapshot();
    const [summary] = sheets;
    expect(summary.rows[3].cells[2]).toMatchObject({ text: '(¥7,996)', style: { color: 'var(--sheet-negative)' } });
    expect(summary.charts[0]).toMatchObject({ kind: 'line', title: '月次損益', series: [{ name: '残高', color: '#0f9d58', values: [349346, 350153, 342157] }], categories: ['8月', '9月', '10月'] });
  });

  it('a Word document', async () => {
    const doc = await readDocLayout(await wordDocument());
    expect(doc).toMatchSnapshot();
    const paras = doc.blocks.filter((b): b is DocPara => b.kind === 'p');
    expect(paras.map((p) => p.marker).filter(Boolean)).toEqual(['1.', '(i)', '2.', '•']);
    expect(paras[0].runs[0]).toMatchObject({ font: '游ゴシック Light', size: 28 });
    expect(paras[1].runs[0]).toMatchObject({ bold: true, color: '#156082' });
    expect((doc.blocks.find((b) => b.kind === 'table') as DocTable).rows[1][0].rowSpan).toBe(2);
  });
});

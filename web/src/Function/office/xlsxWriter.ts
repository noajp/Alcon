import JSZip from 'jszip';
import { dayIndexOf } from '@/Function/shared/dateUtils';

// A workbook written from tables: one sheet per table, its column names as
// a bold, frozen header row with a filter, numbers as numbers, dates as
// Excel dates (shown yyyy-mm-dd), checkboxes as TRUE / FALSE, everything
// else as text. Written with JSZip alone, so it runs anywhere and needs no
// service: what comes out is the same for the same table.

export type SheetValue = string | number | boolean | null;
export interface SheetToWrite {
  name: string;
  columns: { name: string; type: 'text' | 'number' | 'date' | 'select' | 'checkbox' }[];
  rows: SheetValue[][];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Characters XML 1.0 cannot carry at all.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** "A", "B", … "Z", "AA", … for a 0-based column. */
function columnName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** A sheet name Excel accepts: no []:*?/\, at most 31 characters, unique. */
function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    const base = raw.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

// Excel counts days from 1899-12-30; 1970-01-01 is day 25569.
const EXCEL_EPOCH = 25569;
// Styles: 0 plain, 1 bold header, 2 date.
const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

function cellXml(ref: string, value: SheetValue, type: SheetToWrite['columns'][number]['type']): string {
  if (value === null || value === '') return '';
  if (typeof value === 'boolean' || type === 'checkbox') return `<c r="${ref}" t="b"><v>${value === true || value === 'true' ? 1 : 0}</v></c>`;
  if (typeof value === 'number') return Number.isFinite(value) ? `<c r="${ref}"><v>${value}</v></c>` : '';
  const day = type === 'date' ? dayIndexOf(value) : null;
  if (day !== null) return `<c r="${ref}" s="2"><v>${day + EXCEL_EPOCH}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml(sheet: SheetToWrite): string {
  const n = sheet.columns.length;
  const width = (i: number) => {
    const longest = Math.max(sheet.columns[i].name.length, ...sheet.rows.slice(0, 200).map((r) => String(r[i] ?? '').length));
    return Math.min(60, Math.max(8, longest * 1.15 + 2));
  };
  const cols = n ? `<cols>${sheet.columns.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${width(i).toFixed(1)}" customWidth="1"/>`).join('')}</cols>` : '';
  const header = `<row r="1">${sheet.columns.map((c, i) => `<c r="${columnName(i)}1" t="inlineStr" s="1"><is><t xml:space="preserve">${esc(c.name)}</t></is></c>`).join('')}</row>`;
  const body = sheet.rows.map((row, r) => `<row r="${r + 2}">${sheet.columns.map((c, i) => cellXml(`${columnName(i)}${r + 2}`, row[i] ?? null, c.type)).join('')}</row>`).join('');
  const last = `${columnName(Math.max(0, n - 1))}${sheet.rows.length + 1}`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `${cols}<sheetData>${header}${body}</sheetData>`
    + (n ? `<autoFilter ref="A1:${last}"/>` : '')
    + '</worksheet>';
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The workbook's bytes. */
export async function writeWorkbook(sheets: SheetToWrite[]): Promise<Uint8Array> {
  const names = sheetNames(sheets.map((s) => s.name));
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '</Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + names.map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + '</sheets>'
    + (sheets.some((s) => s.columns.length) ? `<definedNames>${sheets.map((s, i) => (s.columns.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i].replace(/'/g, "''"))}'!$A$1:$${columnName(s.columns.length - 1)}$${s.rows.length + 1}</definedName>` : '')).join('')}</definedNames>` : '')
    + '</workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + '</Relationships>');
  zip.file('xl/styles.xml', STYLES);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

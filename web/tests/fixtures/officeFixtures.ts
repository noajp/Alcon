import JSZip from 'jszip';

// Sample Office files as the tools people use produce them, built in code so
// they are the same bytes on every run: a deck made in PowerPoint (master,
// layout, placeholders that carry no position, theme colours and fonts,
// gradient, group, table, cropped picture), a workbook exported from Google
// Sheets (styles, merges, a chart whose values live in another sheet), and
// a Word document (styles through basedOn, lists, a shaded table, a page
// break). The golden tests read each and compare the whole result.

const zipOf = (files: Record<string, string>) => {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: 'arraybuffer' });
};

const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const rels = (...targets: [string, string][]) => `<Relationships>${targets.map(([id, t]) => `<Relationship Id="${id}" Target="${t}"/>`).join('')}</Relationships>`;

export function powerPointDeck() {
  const ph = (type: string | null, idx: string | null, xfrm: string, extra = '') =>
    `<p:sp><p:nvSpPr><p:nvPr><p:ph${type ? ` type="${type}"` : ''}${idx ? ` idx="${idx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr>${xfrm}</p:spPr>${extra}</p:sp>`;
  const xf = (x: number, y: number, w: number, h: number) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;
  return zipOf({
    'ppt/presentation.xml': `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/>`
      + '<p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels(['rId2', 'slides/slide1.xml'], ['rId3', 'slides/slide2.xml']),
    'ppt/theme/theme1.xml': `<a:theme ${P}><a:themeElements><a:clrScheme><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0E2841"/></a:dk2><a:lt2><a:srgbClr val="E8E8E8"/></a:lt2><a:accent1><a:srgbClr val="156082"/></a:accent1><a:accent2><a:srgbClr val="E97132"/></a:accent2></a:clrScheme>`
      + '<a:fontScheme><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="游ゴシック Light"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="游ゴシック"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>',
    'ppt/slideMasters/slideMaster1.xml': `<p:sldMaster ${P}><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg><p:spTree>`
      + ph('title', null, xf(838200, 365125, 10515600, 1325563))
      + ph('body', '1', xf(838200, 1825625, 10515600, 4351338))
      + ph('sldNum', '12', xf(8610600, 6356350, 2743200, 365125))
      + `<p:sp><p:spPr>${xf(0, 6705600, 12192000, 152400)}<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="accent1"/></a:gs><a:gs pos="100000"><a:schemeClr val="accent2"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill></p:spPr></p:sp>`
      + '</p:spTree></p:cSld><p:txStyles>'
      + '<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/></a:defRPr></a:lvl1pPr></p:titleStyle>'
      + '<p:bodyStyle><a:lvl1pPr marL="228600"><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr>'
      + '<a:lvl2pPr marL="685800"><a:buChar char="–"/><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle><p:otherStyle/></p:txStyles></p:sldMaster>',
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels(['rId1', '../theme/theme1.xml']),
    'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout ${P}><p:cSld><p:spTree>`
      + ph('ctrTitle', null, xf(1524000, 1122363, 9144000, 2387600), '<p:txBody><a:bodyPr anchor="b"/><a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="6000"/></a:lvl1pPr></a:lstStyle><a:p/></p:txBody>')
      + ph('subTitle', '1', xf(1524000, 3602038, 9144000, 1655762), '<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr marL="0" algn="ctr"><a:buNone/><a:defRPr sz="2400"/></a:lvl1pPr></a:lstStyle><a:p/></p:txBody>')
      + '</p:spTree></p:cSld></p:sldLayout>',
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels(['rId1', '../slideMasters/slideMaster1.xml']),
    'ppt/slideLayouts/slideLayout2.xml': `<p:sldLayout ${P}><p:cSld><p:spTree></p:spTree></p:cSld></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout2.xml.rels': rels(['rId1', '../slideMasters/slideMaster1.xml']),
    'ppt/slides/slide1.xml': `<p:sld ${P}><p:cSld><p:spTree>`
      + ph('ctrTitle', null, '', '<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="ja-JP"/><a:t>2026年度 事業計画</a:t></a:r></a:p></p:txBody>')
      + ph('subTitle', '1', '', '<p:txBody><a:bodyPr/><a:p><a:r><a:t>経営会議資料</a:t></a:r></a:p></p:txBody>')
      + '</p:spTree></p:cSld></p:sld>',
    'ppt/slides/_rels/slide1.xml.rels': rels(['rId1', '../slideLayouts/slideLayout1.xml']),
    'ppt/slides/slide2.xml': `<p:sld ${P}><p:cSld><p:spTree>`
      + ph('title', null, '', '<p:txBody><a:bodyPr/><a:p><a:r><a:t>重点施策</a:t></a:r></a:p></p:txBody>')
      + ph(null, '1', xf(838200, 1825625, 5181600, 4351338), '<p:txBody><a:bodyPr><a:normAutofit fontScale="92500" lnSpcReduction="10000"/></a:bodyPr><a:p><a:r><a:t>新規顧客の獲得</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>紹介制度</a:t></a:r></a:p></p:txBody>')
      + `<p:grpSp><p:grpSpPr><a:xfrm><a:off x="6400800" y="1825625"/><a:ext cx="4953000" cy="2000000"/><a:chOff x="0" y="0"/><a:chExt cx="2476500" cy="1000000"/></a:xfrm></p:grpSpPr>`
      + `<p:sp><p:spPr>${xf(0, 0, 2476500, 1000000)}<a:prstGeom prst="roundRect"/><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="20000"/><a:lumOff val="80000"/></a:schemeClr></a:solidFill><a:ln w="12700"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln></p:spPr>`
      + '<p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2000" b="1"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr><a:t>売上 +20%</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp>'
      + `<p:graphicFrame><p:xfrm><a:off x="6400800" y="4200000"/><a:ext cx="4953000" cy="740000"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="2476500"/><a:gridCol w="2476500"/></a:tblGrid>`
      + '<a:tr h="370000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr b="1"/><a:t>指標</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:tcPr></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>目標</a:t></a:r></a:p></a:txBody></a:tc></a:tr>'
      + '<a:tr h="370000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>解約率</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>3%以下</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
      + `<p:pic><p:blipFill><a:blip r:embed="rId9"/><a:srcRect t="25000" b="25000"/></p:blipFill><p:spPr>${xf(838200, 6200000, 1000000, 500000)}</p:spPr></p:pic>`
      + '</p:spTree></p:cSld></p:sld>',
    'ppt/slides/_rels/slide2.xml.rels': rels(['rId1', '../slideLayouts/slideLayout2.xml'], ['rId9', '../media/logo.png']),
    'ppt/media/logo.png': 'logo',
  });
}

const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

export function googleSheetsWorkbook() {
  return zipOf({
    'xl/workbook.xml': `<workbook ${S}><sheets><sheet name="サマリ" sheetId="1" r:id="rId5"/><sheet name="データ" sheetId="2" r:id="rId6"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels(['rId1', 'theme/theme1.xml'], ['rId5', 'worksheets/sheet1.xml'], ['rId6', 'worksheets/sheet2.xml']),
    'xl/theme/theme1.xml': '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1></a:clrScheme></a:themeElements></a:theme>',
    'xl/styles.xml': `<styleSheet ${S}><numFmts><numFmt numFmtId="164" formatCode="&quot;¥&quot;#,##0_);[Red]\\(&quot;¥&quot;#,##0\\)"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>`
      + '<fonts><font><sz val="12.0"/><color theme="1"/><name val="Arial"/></font><font><b/><sz val="12.0"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><sz val="18.0"/><color rgb="FF000000"/><name val="Arial"/></font></fonts>'
      + '<fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="lightGray"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3D85C6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor theme="4" tint="0.7999816888943144"/></patternFill></fill></fills>'
      + '<borders><border/><border><bottom style="medium"><color rgb="FF1F4E79"/></bottom></border><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border></borders>'
      + '<cellXfs><xf/><xf fontId="1" fillId="2" borderId="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" borderId="2"/><xf numFmtId="165" fillId="3" borderId="2"/><xf fontId="2"/></cellXfs></styleSheet>',
    'xl/sharedStrings.xml': `<sst ${S}><si><t>運用パフォーマンス</t></si><si><t>月</t></si><si><t>損益</t></si><si><t>利回り</t></si><si><t>8月</t></si><si><t>9月</t></si></sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet ${S}><sheetViews><sheetView showGridLines="0"/></sheetViews><sheetFormatPr defaultColWidth="10.1" defaultRowHeight="15.0"/><cols><col min="1" max="1" width="2.1" customWidth="1"/><col min="2" max="4" width="12.0" customWidth="1"/></cols><sheetData>`
      + '<row r="1" ht="24"><c r="B1" s="4" t="s"><v>0</v></c></row>'
      + '<row r="2"><c r="B2" s="1" t="s"><v>1</v></c><c r="C2" s="1" t="s"><v>2</v></c><c r="D2" s="1" t="s"><v>3</v></c></row>'
      + '<row r="3"><c r="B3" t="s"><v>4</v></c><c r="C3" s="2"><v>807.0</v></c><c r="D3" s="3"><v>0.0023</v></c></row>'
      + '<row r="4"><c r="B4" t="s"><v>5</v></c><c r="C4" s="2"><v>-7996.0</v></c><c r="D4" s="3"><v>-0.0228</v></c></row>'
      + '</sheetData><mergeCells><mergeCell ref="B1:D1"/></mergeCells><drawing r:id="rId1"/></worksheet>',
    'xl/worksheets/_rels/sheet1.xml.rels': rels(['rId1', '../drawings/drawing1.xml']),
    'xl/drawings/drawing1.xml': '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="4572000" cy="2743200"/><xdr:graphicFrame><a:graphic><a:graphicData><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:oneCellAnchor></xdr:wsDr>',
    'xl/drawings/_rels/drawing1.xml.rels': rels(['rId1', '../charts/chart1.xml']),
    'xl/charts/chart1.xml': '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>月次損益</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:lineChart><c:grouping val="standard"/>'
      + "<c:ser><c:tx><c:strRef><c:f>'データ'!$B$1</c:f></c:strRef></c:tx><c:spPr><a:ln><a:solidFill><a:srgbClr val=\"0F9D58\"/></a:solidFill></a:ln></c:spPr><c:cat><c:strRef><c:f>'データ'!$A$2:$A$4</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>'データ'!$B$2:$B$4</c:f><c:numCache/></c:numRef></c:val></c:ser>"
      + '</c:lineChart></c:plotArea></c:chart></c:chartSpace>',
    'xl/worksheets/sheet2.xml': `<worksheet ${S}><sheetData><row r="1"><c r="A1" t="str"><v>月</v></c><c r="B1" t="str"><v>残高</v></c></row>`
      + '<row r="2"><c r="A2" t="str"><v>8月</v></c><c r="B2"><v>349346</v></c></row><row r="3"><c r="A3" t="str"><v>9月</v></c><c r="B3"><v>350153</v></c></row><row r="4"><c r="A4" t="str"><v>10月</v></c><c r="B4"><v>342157</v></c></row></sheetData></worksheet>',
  });
}

const D = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export function wordDocument() {
  const p = (t: string, pPr = '', rPr = '') => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const li = (num: number, lvl: number, t: string) => p(t, `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${num}"/></w:numPr>`);
  const tc = (t: string, pr = '') => `<w:tc><w:tcPr>${pr}</w:tcPr>${p(t)}</w:tc>`;
  return zipOf({
    'word/document.xml': `<w:document ${D}><w:body>`
      + p('議事録', '<w:pStyle w:val="Title"/>')
      + p('決定事項', '<w:pStyle w:val="Heading1"/>')
      + li(1, 0, '料金を改定する') + li(1, 1, '月額 ¥980') + li(1, 0, '招待制を続ける')
      + p('次回までに', '<w:pStyle w:val="Heading1"/>')
      + li(2, 0, '見積もりを出す')
      + `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="4000"/></w:tblGrid>`
      + `<w:tr>${tc('担当', '<w:shd w:val="clear" w:fill="1F4E79"/>')}${tc('内容', '<w:shd w:val="clear" w:fill="1F4E79"/>')}</w:tr>`
      + `<w:tr>${tc('中野', '<w:vMerge w:val="restart"/>')}${tc('見積もり')}</w:tr><w:tr>${tc('', '<w:vMerge/>')}${tc('資料')}</w:tr></w:tbl>`
      + `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`
      + p('補足: ', '', '<w:b/><w:color w:val="C00000"/>') + p('価格は仮です。', '<w:jc w:val="right"/>', '<w:highlight w:val="yellow"/>')
      + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1985" w:right="1701" w:bottom="1701" w:left="1701"/></w:sectPr></w:body></w:document>',
    'word/styles.xml': `<w:styles ${D}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia"/><w:sz w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia"/><w:sz w:val="56"/></w:rPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="360" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="0F4761" w:themeColor="accent1"/></w:rPr></w:style></w:styles>',
    'word/numbering.xml': `<w:numbering ${D}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="420" w:hanging="420"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="(%2)"/><w:pPr><w:ind w:left="840" w:hanging="420"/></w:pPr></w:lvl></w:abstractNum>`
      + '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val=""/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>',
    'word/theme/theme1.xml': '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:accent1><a:srgbClr val="156082"/></a:accent1></a:clrScheme><a:fontScheme><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="游ゴシック Light"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="游明朝"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>',
  });
}

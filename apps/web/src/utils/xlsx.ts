import JSZip from 'jszip';

export type SpreadsheetCell = string | number | boolean | null | undefined | { decimal: string };
const xml = (value: string) => value
  .replace(/_x[0-9a-f]{4}_/gi, (s) => '_x005F_' + s.slice(1))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\r\ufffe\uffff]/g, c => '_x' + c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase() + '_')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const columnName = (index: number) => {
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
};
function cell(value: SpreadsheetCell, address: string, header = false): string {
  const style = header ? ' s="1"' : '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('导出包含无效数值');
    return `<c r="${address}"${style}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') return `<c r="${address}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
  if (value && typeof value === 'object') {
    const decimal = value.decimal;
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(decimal)) throw new Error('导出金额格式无效');
    // Excel has 15 significant digits. Preserve larger amounts as text instead of rounding them.
    if (decimal.replace(/^-?0*/, '').replace('.', '').length <= 15) return `<c r="${address}" s="2"><v>${decimal}</v></c>`;
    value = decimal;
  }
  // User-controlled values always have an explicit string type and can never create a formula.
  return `<c r="${address}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(String(value ?? ''))}</t></is></c>`;
}
export async function buildSpreadsheet(headers: string[], rows: SpreadsheetCell[][]): Promise<Uint8Array> {
  if (!headers.length || headers.length > 128 || rows.length > 1000 || rows.some(r => r.length !== headers.length)) throw new Error('导出仅支持当前页，最多1000行及128列');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="CRM明细" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF1E40AF"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  const end = columnName(headers.length - 1) + (rows.length + 1);
  const data = [headers, ...rows].map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, columnName(j) + (i + 1), i === 0)).join('')}</row>`).join('');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${end}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${headers.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="24" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData><autoFilter ref="A1:${end}"/></worksheet>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
export async function downloadSpreadsheet(name: string, headers: string[], rows: SpreadsheetCell[][]) {
  const bytes = await buildSpreadsheet(headers, rows);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = name + '.xlsx'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

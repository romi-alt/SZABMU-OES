/**
 * Minimal .xlsx reader/writer for question import and export. No dependencies: an .xlsx is a zip of XML files, and the browser can inflate/deflate natively.
 * Reading is defensive because the file is untrusted: the file, the number of entries and every inflated entry are size-capped (zip-bomb guard),
 * encrypted/zip64/unknown-method entries are refused, only the first worksheet is read, and the XML is parsed by the browser's DOMParser (no scripts, no network).
 * Writing uses stored (uncompressed) zip entries and inline strings, so a cell is always text and is never interpreted as a formula by Excel.
 * The server never sees the spreadsheet: the browser turns it into the same rows as a CSV, and the API validates those exactly as it does for manual entry.
 */
export const MAX_XLSX_BYTES = 2_000_000;
const MAX_ENTRIES = 200; const MAX_PART_BYTES = 8_000_000; const MAX_ROWS = 2_001; const MAX_COLS = 30;
export class XlsxError extends Error {}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const dec = new TextDecoder('utf-8'); const enc = new TextEncoder();

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.length; if (total > expected || total > MAX_PART_BYTES) { await reader.cancel(); throw new XlsxError('The spreadsheet contains data that is too large to read.'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  if (buf.length > MAX_XLSX_BYTES) throw new XlsxError('The file is too large (2 MB at most).');
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new XlsxError('This is not an Excel (.xlsx) file.');
  const count = u16(buf, eocd + 10); let at = u32(buf, eocd + 16);
  if (count > MAX_ENTRIES) throw new XlsxError('The spreadsheet has too many internal parts.');
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || u32(buf, at) !== 0x02014b50) throw new XlsxError('The Excel file is damaged.');
    const flags = u16(buf, at + 8), method = u16(buf, at + 10), csize = u32(buf, at + 20), usize = u32(buf, at + 24), nlen = u16(buf, at + 28), elen = u16(buf, at + 30), clen = u16(buf, at + 32), lho = u32(buf, at + 42);
    const name = dec.decode(buf.subarray(at + 46, at + 46 + nlen)); at += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    if (!/^(xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)|\[Content_Types\]\.xml)$/.test(name)) continue;   // only the parts that are needed
    if (flags & 1) throw new XlsxError('Password-protected Excel files are not supported.');
    if (csize === 0xffffffff || usize === 0xffffffff) throw new XlsxError('This Excel file uses an unsupported format.');
    if (usize > MAX_PART_BYTES) throw new XlsxError('The spreadsheet contains data that is too large to read.');
    if (lho + 30 > buf.length || u32(buf, lho) !== 0x04034b50) throw new XlsxError('The Excel file is damaged.');
    const start = lho + 30 + u16(buf, lho + 26) + u16(buf, lho + 28); const comp = buf.subarray(start, start + csize);
    if (comp.length !== csize) throw new XlsxError('The Excel file is damaged.');
    if (method === 0) out.set(name, comp); else if (method === 8) out.set(name, await inflateRaw(comp, usize)); else throw new XlsxError('This Excel file uses an unsupported format.');
  }
  return out;
}

function xml(bytes: Uint8Array | undefined): Document | null {
  if (!bytes) return null;
  const d = new DOMParser().parseFromString(dec.decode(bytes), 'application/xml');
  if (d.getElementsByTagName('parsererror').length) throw new XlsxError('The Excel file is damaged.');
  return d;
}
const text = (el: Element) => Array.from(el.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('');
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/** The first worksheet as rows of text cells (empty cells are ''), blank rows removed. */
export async function readXlsx(file: Blob): Promise<string[][]> {
  if (typeof DecompressionStream === 'undefined') throw new XlsxError('This browser cannot read Excel files. Save the sheet as CSV instead.');
  const parts = await unzip(new Uint8Array(await file.arrayBuffer()));
  const book = xml(parts.get('xl/workbook.xml')); if (!book) throw new XlsxError('This is not an Excel (.xlsx) file.');
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const first = book.getElementsByTagName('sheet')[0]; const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const rels = xml(parts.get('xl/_rels/workbook.xml.rels'));
  if (rid && rels) for (const r of Array.from(rels.getElementsByTagName('Relationship'))) if (r.getAttribute('Id') === rid) { const t = r.getAttribute('Target') ?? ''; sheetPath = t.startsWith('/') ? t.slice(1) : `xl/${t}`; }
  const sheet = xml(parts.get(sheetPath)); if (!sheet) throw new XlsxError('The first worksheet could not be found.');
  const shared = xml(parts.get('xl/sharedStrings.xml')); const strings = shared ? Array.from(shared.getElementsByTagName('si')).map(text) : [];
  const rows: string[][] = [];
  for (const row of Array.from(sheet.getElementsByTagName('row')).slice(0, MAX_ROWS)) {
    const cells: string[] = [];
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r'); const i = ref ? colIndex(ref) : cells.length; if (i < 0 || i >= MAX_COLS) continue;
      const t = c.getAttribute('t'); const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      cells[i] = t === 's' ? (strings[Number(v)] ?? '') : t === 'inlineStr' ? text(c) : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
    }
    const filled = Array.from(cells, (x) => x ?? ''); if (filled.some((x) => x.trim() !== '')) rows.push(filled);
  }
  return rows;
}

// ── writer ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** XML-escapes text and drops the control characters XML 1.0 forbids (tab, newline and carriage return are kept). */
const esc = (s: string) => Array.from(s).filter((ch) => { const c = ch.charCodeAt(0); return c >= 32 || c === 9 || c === 10 || c === 13; }).join('').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const colName = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

export function writeXlsx(sheetName: string, head: string[], rows: (string | number)[][]): Blob {
  const cell = (v: string | number, r: number, c: number) => typeof v === 'number' && Number.isFinite(v) ? `<c r="${colName(c)}${r}"><v>${v}</v></c>` : `<c r="${colName(c)}${r}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[head, ...rows].map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r + 1, c)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files: [string, string][] = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet],
  ];
  const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const [name, content] of files) {
    const n = enc.encode(name), d = enc.encode(content), crc = crc32(d);
    const local = new Uint8Array(30 + n.length); const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true); lv.setUint32(14, crc, true); lv.setUint32(18, d.length, true); lv.setUint32(22, d.length, true); lv.setUint16(26, n.length, true); local.set(n, 30);
    const cen = new Uint8Array(46 + n.length); const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint32(16, crc, true); cv.setUint32(20, d.length, true); cv.setUint32(24, d.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, offset, true); cen.set(n, 46);
    parts.push(local, d); central.push(cen); offset += local.length + d.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0); const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end] as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

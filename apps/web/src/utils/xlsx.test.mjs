import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildSpreadsheet } from './xlsx.ts';
const sheet = async bytes => (await JSZip.loadAsync(bytes, { checkCRC32: true })).file('xl/worksheets/sheet1.xml').async('string');
test('formula-like customer names are explicitly typed strings with no executable formula or external link', async () => {
  const values = ['=1+1', ' =1+1', '\n=1+1', '＝1+1', '@SUM(1,1)', '<f>SUM(A1)</f>', '=HYPERLINK("https://example.invalid","test")'];
  const bytes = await buildSpreadsheet(['客户'], values.map(v => [v]));
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const xml = await sheet(bytes);
  assert.equal((xml.match(/t="inlineStr"/g)||[]).length, values.length + 1);
  assert.doesNotMatch(xml, /<f(?:\s|>)/);
  assert.equal(Object.keys(zip.files).some(name => /externalLink|vba|macro/i.test(name)), false);
  assert(xml.includes('&lt;f&gt;SUM(A1)&lt;/f&gt;'));
});
test('amounts use numeric cells and identifiers remain text; excess precision is never rounded', async () => {
  const xml = await sheet(await buildSpreadsheet(['金额','编号','大额'], [[{decimal:'1234.50'},'00123',{decimal:'1234567890123456.78'}]]));
  assert(xml.includes('<c r="A2" s="2"><v>1234.50</v></c>'));
  assert(xml.includes('<t xml:space="preserve">00123</t>'));
  assert(xml.includes('<t xml:space="preserve">1234567890123456.78</t>'));
});
test('XML characters, existing entity text and OOXML escape sequences remain inert', async () => {
  const xml = await sheet(await buildSpreadsheet(['文本'], [['A&B<客户>'], ['&#x3C;f>'], ['_x0041_'], ['\u0000=1+1']]));
  assert(xml.includes('A&amp;B&lt;客户&gt;'));
  assert(xml.includes('&amp;#x3C;f&gt;'));
  assert(xml.includes('_x005F_x0041_'));
  assert.doesNotMatch(xml, /\u0000|<f>/);
});
test('headers remain present for empty results and column names extend past Z', async () => {
  const xml = await sheet(await buildSpreadsheet(Array.from({length:28},(_,i)=>'列'+i), []));
  assert(xml.includes('r="AA1"')); assert(xml.includes('r="AB1"'));
  assert(xml.includes('state="frozen"')); assert(xml.includes('<autoFilter ref="A1:AB1"/>'));
});
test('invalid dimensions, nonfinite values and malformed decimal input are rejected', async () => {
  for (const args of [[[],[]], [['A'],[[1,2]]], [['A'],Array.from({length:1001},()=>[1])], [['A'],[[NaN]]], [['A'],[[{decimal:'1+1'}]]]]) await assert.rejects(buildSpreadsheet(...args));
});

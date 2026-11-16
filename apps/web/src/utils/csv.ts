/** Spreadsheet viewing export; never use this representation as a lossless backup/import format. */
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  const normalized = text.normalize('NFKC');
  const formula = /^[\s\p{Cf}\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(normalized);
  const leadingControl = /^[\s\p{Cf}]*[\u0000-\u001f\u007f-\u009f]/u.test(text);
  // A tab resists Excel save/reopen normalization; a text marker also protects first-open readers.
  // Keep both inside the quoted field. Quotes/separators in the original data cannot create a new cell.
  if (!(typeof value === 'number' && Number.isFinite(value)) && (formula || leadingControl)) text = "\t'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function detectDelimiter(sampleLine) {
  const comma = (sampleLine.match(/,/g) || []).length;
  const semi = (sampleLine.match(/;/g) || []).length;
  const tab = (sampleLine.match(/\t/g) || []).length;
  if (semi > comma && semi >= tab) return ';';
  if (tab > comma && tab > semi) return '\t';
  return ',';
}

function isJunkLine(line) {
  if (!line) return true;
  const t = line.trim();
  if (!t) return true;
  if (/^[,\s]+$/.test(t)) return true;
  if (/^[;\s]+$/.test(t)) return true;
  if (/^[\t\s]+$/.test(t)) return true;
  if (/^from\s+\d{4}-\d{2}-\d{2}\s+to\s+\d{4}-\d{2}-\d{2}/i.test(t)) return true;
  return false;
}

export function parseCSV(text) {
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');
  let firstNonJunk = '';
  for (const ln of lines) {
    if (!isJunkLine(ln)) { firstNonJunk = ln; break; }
  }
  const delimiter = detectDelimiter(firstNonJunk);

  const rows = [];
  let row = [];
  let i = 0, field = '', inQuotes = false;

  function endField() { row.push(field); field = ''; }
  function endRow() { rows.push(row); row = []; }

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        const next = text[i+1];
        if (next === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      } else {
        field += c; i++; continue;
      }
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === delimiter) { endField(); i++; continue; }
      if (c === '\n') { endField(); endRow(); i++; continue; }
      field += c; i++; continue;
    }
  }
  endField();
  if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) endRow();

  const cleaned = rows.filter(r => r.some(cell => String(cell ?? '').trim() !== ''));
  const cleaned2 = cleaned.filter(r => !isJunkLine(r.join(delimiter)));
  return { rows: cleaned2, delimiter };
}


export function parseCSV(text, delimiter = ',') {
  // Robust-ish CSV parser (RFC4180-ish)
  const rows = [];
  let row = [];
  let i = 0, field = '', inQuotes = false;

  function endField() {
    row.push(field);
    field = '';
  }
  function endRow() {
    // ignore trailing empty last line
    rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        const next = text[i+1];
        if (next === '"') { // escaped quote
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += c;
        i++;
        continue;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === delimiter) {
        endField();
        i++;
        continue;
      }
      if (c === '\r') { // handle CRLF
        // ignore; LF will handle
        i++;
        continue;
      }
      if (c === '\n') {
        endField();
        endRow();
        i++;
        continue;
      }
      field += c;
      i++;
    }
  }
  endField();
  // Only add last row if it has any content
  if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) endRow();
  return rows;
}

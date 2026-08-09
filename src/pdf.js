/**
 * Minimal single-page text PDF writer. Zero dependencies.
 * Good enough for invoices / bills; uses built-in Helvetica.
 */

function escapePdfText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * @param {{ title?: string, lines: Array<string|null|undefined> }} doc
 * @returns {Buffer}
 */
function buildTextPdf({ title = 'Document', lines = [] } = {}) {
  const pageWidth = 612; // US Letter
  const pageHeight = 792;
  const marginLeft = 54;
  const top = 744;
  const lineHeight = 14;
  const fontSize = 11;
  const titleSize = 16;

  const content = [];
  let y = top;

  content.push('BT');
  content.push(`/F1 ${titleSize} Tf`);
  content.push(`${marginLeft} ${y} Td`);
  content.push(`(${escapePdfText(title)}) Tj`);
  y -= titleSize + 10;
  content.push('ET');

  content.push('BT');
  content.push(`/F1 ${fontSize} Tf`);
  content.push(`${marginLeft} ${y} Td`);
  let first = true;
  for (const raw of lines) {
    const text = raw == null ? '' : String(raw);
    // Soft-wrap long lines (~95 chars at 11pt Helvetica)
    const chunks = wrapLine(text, 95);
    for (const chunk of chunks) {
      if (!first) content.push(`0 -${lineHeight} Td`);
      content.push(`(${escapePdfText(chunk)}) Tj`);
      first = false;
      y -= lineHeight;
      if (y < 54) break; // stay on one page for v1
    }
    if (y < 54) break;
  }
  content.push('ET');

  const stream = content.join('\n');
  const streamBuf = Buffer.from(stream, 'utf8');

  const objects = [];
  objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n');
  objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n');
  objects.push(
    `3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] `
    + '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n'
  );
  objects.push(
    `4 0 obj<< /Length ${streamBuf.length} >>stream\n${stream}\nendstream\nendobj\n`
  );
  objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function wrapLine(text, width) {
  if (!text) return [''];
  if (text.length <= width) return [text];
  const out = [];
  let rest = text;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(' ', width);
    if (cut < Math.floor(width / 2)) cut = width;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest) out.push(rest);
  return out;
}

module.exports = { buildTextPdf };

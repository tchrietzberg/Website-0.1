/**
 * Minimal multi-page text PDF writer. Zero dependencies.
 * Uses built-in Helvetica — good enough for invoices and lodestar reports.
 */

function escapePdfText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
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

/**
 * @param {{ title?: string, lines: Array<string|null|undefined>, wrapWidth?: number }} doc
 * @returns {Buffer}
 */
function buildTextPdf({ title = 'Document', lines = [], wrapWidth = 95 } = {}) {
  const pageWidth = 612;
  const pageHeight = 792;
  const marginLeft = 54;
  const top = 744;
  const bottom = 54;
  const lineHeight = 13;
  const fontSize = 10;
  const titleSize = 14;

  const pageStreams = [];
  let ops = [];
  let y = top;
  let titled = false;

  const flushPage = () => {
    pageStreams.push(ops.join('\n'));
    ops = [];
    y = top;
    titled = false;
  };

  const ensureSpace = (needed = lineHeight) => {
    if (y - needed < bottom) flushPage();
  };

  const writeAt = (text, size) => {
    ensureSpace(size + 4);
    ops.push('BT');
    ops.push(`/F1 ${size} Tf`);
    ops.push(`${marginLeft} ${y} Td`);
    ops.push(`(${escapePdfText(text)}) Tj`);
    ops.push('ET');
    y -= size + (size >= titleSize ? 10 : 3);
  };

  writeAt(title, titleSize);
  titled = true;

  for (const raw of lines) {
    const text = raw == null ? '' : String(raw);
    for (const chunk of wrapLine(text, wrapWidth)) {
      if (!titled && pageStreams.length) {
        // continuation pages keep body text only
      }
      writeAt(chunk, fontSize);
      titled = true;
    }
  }
  if (ops.length) flushPage();
  if (!pageStreams.length) pageStreams.push('');

  const fontNum = 3 + pageStreams.length * 2;
  const objs = [];
  objs[1] = '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n';
  const kidRefs = pageStreams.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs[2] = `2 0 obj<< /Type /Pages /Kids [${kidRefs}] /Count ${pageStreams.length} >>endobj\n`;

  for (let i = 0; i < pageStreams.length; i++) {
    const pageNum = 3 + i * 2;
    const contentNum = pageNum + 1;
    const stream = pageStreams[i];
    const len = Buffer.byteLength(stream, 'utf8');
    objs[pageNum] = (
      `${pageNum} 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] `
      + `/Contents ${contentNum} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>endobj\n`
    );
    objs[contentNum] = (
      `${contentNum} 0 obj<< /Length ${len} >>stream\n${stream}\nendstream\nendobj\n`
    );
  }
  objs[fontNum] = `${fontNum} 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i <= fontNum; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'utf8');
    pdf += objs[i];
  }
  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${fontNum + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= fontNum; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${fontNum + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

module.exports = { buildTextPdf };

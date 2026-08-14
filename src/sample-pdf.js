'use strict';

/**
 * Builds a one-page PDF in memory so the proof run has something to send
 * without pulling in a PDF library. Replace with the real contract PDF
 * (or a template_id) once we are inside Fortva.
 */
function buildSamplePdf(lines = ['Fortva x OpenSign - integration proof', 'Please sign below.']) {
  const esc = (s) => String(s).replace(/([()\\])/g, '\\$1');
  const text = lines
    .map((l, i) => `BT /F1 14 Tf 60 ${700 - i * 24} Td (${esc(l)}) Tj ET`)
    .join('\n');
  const stream = `${text}\n`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefPos = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

module.exports = { buildSamplePdf };

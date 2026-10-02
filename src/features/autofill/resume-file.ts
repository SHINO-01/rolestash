import { unzipSync } from 'fflate';

/**
 * Plain text from a résumé file, on this device (ADR-0020 addendum). Word
 * files are unzipped and their XML read; PDFs go through pdf.js, loaded only
 * when needed, with eval off and no fonts or maps fetched from anywhere. The
 * file itself is never stored or sent.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Unzipped XML we're willing to read: guards against zip bombs. */
const MAX_XML_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 6;

export class ResumeFileError extends Error {
  constructor(readonly reason: 'type' | 'size' | 'unreadable') {
    super(
      reason === 'type'
        ? 'Choose a PDF or Word (.docx) file.'
        : reason === 'size'
          ? 'That file is too large. Choose one under 10 MB.'
          : 'Couldn’t read text from that file. If it’s a scanned image, type your details instead.',
    );
    this.name = 'ResumeFileError';
  }
}

export async function resumeText(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new ResumeFileError('size');
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    if (name.endsWith('.docx') || file.type.includes('wordprocessingml')) text = docxText(bytes);
    else if (name.endsWith('.pdf') || file.type === 'application/pdf') text = await pdfText(bytes);
    else throw new ResumeFileError('type');
  } catch (e) {
    if (e instanceof ResumeFileError) throw e;
    throw new ResumeFileError('unreadable');
  }
  if (!text.trim()) throw new ResumeFileError('unreadable');
  return text;
}

/** Headers first (contact details often live there), then the body. */
function docxText(bytes: Uint8Array): string {
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      const wanted = f.name === 'word/document.xml' || /^word\/header\d*\.xml$/.test(f.name);
      if (wanted) total += f.originalSize;
      if (total > MAX_XML_BYTES) throw new ResumeFileError('size');
      return wanted;
    },
  });
  const order = Object.keys(files).sort((a, b) =>
    a === 'word/document.xml' ? 1 : b === 'word/document.xml' ? -1 : a.localeCompare(b),
  );
  if (!order.includes('word/document.xml')) throw new ResumeFileError('unreadable');
  return order.map((n) => wordXmlText(new TextDecoder().decode(files[n]))).join('\n');
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function wordXmlText(xml: string): string {
  // Parsed as XML, inertly: nothing in it runs or loads.
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const lines: string[] = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    let line = '';
    const walk = (node: Element) => {
      for (const child of Array.from(node.children)) {
        if (child.namespaceURI !== W) continue;
        if (child.localName === 't') line += child.textContent;
        else if (child.localName === 'tab') line += '\t';
        else if (child.localName === 'br' || child.localName === 'cr') {
          lines.push(line);
          line = '';
        } else walk(child);
      }
    };
    walk(p);
    lines.push(line);
  }
  return lines.join('\n');
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), {
    type: 'module',
  });
  pdfjs.GlobalWorkerOptions.workerPort = worker;
  let task: ReturnType<typeof pdfjs.getDocument> | undefined;
  try {
    // No cMapUrl, standardFontDataUrl, iccUrl or wasmUrl: pdf.js fetches
    // nothing, and text extraction doesn't need them. (pdf.js 6 has no eval.)
    task = pdfjs.getDocument({
      data: bytes,
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
    });
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const item of content.items)
        if ('str' in item)
          items.push({ str: item.str, transform: item.transform as number[], width: item.width });
      pages.push(linesFromItems(items));
    }
    return pages.join('\n');
  } finally {
    await task?.destroy().catch(() => undefined);
    worker.terminate();
  }
}

/**
 * Rebuilds lines from positioned text: items on the same baseline join, a
 * wide gap becomes a column break (three spaces), which the rules read as a
 * separator like "|".
 */
export function linesFromItems(items: readonly TextItem[]): string {
  const rows: { y: number; parts: { x: number; end: number; str: string }[] }[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    const row = rows.find((r) => Math.abs(r.y - y) < 3);
    const part = { x, end: x + item.width, str: item.str };
    if (row) row.parts.push(part);
    else rows.push({ y, parts: [part] });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((row) => {
      row.parts.sort((a, b) => a.x - b.x);
      let line = '';
      let end = -Infinity;
      for (const part of row.parts) {
        const gap = part.x - end;
        if (line) line += gap > 24 ? '   ' : gap > 1 ? ' ' : '';
        line += part.str;
        end = part.end;
      }
      return line.trim();
    })
    .join('\n');
}

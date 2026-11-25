import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

export const MAX_PAGES = 500;

export type InspectOutcome =
  | { ok: true; pageCount: number; title: string | null; author: string | null; sha256: string; sizeBytes: number; preview: Buffer }
  | { ok: false; code: 'NOT_PDF' | 'TOO_LARGE' | 'EMPTY' | 'ENCRYPTED' | 'CORRUPT' | 'TOO_MANY_PAGES'; message: string };

/**
 * Structural PDF validation used by the LOCAL worker (Function Compute does the same in Python with
 * pypdf + pypdfium2). Checks magic bytes, size, that it parses, is not encrypted, page limit,
 * reads metadata and builds a 1-page preview PDF. Magic bytes ≠ malware scanning (D-11).
 */
export async function inspectPdf(bytes: Buffer, maxBytes: number): Promise<InspectOutcome> {
  if (bytes.length === 0) return { ok: false, code: 'EMPTY', message: 'Tệp rỗng' };
  if (bytes.length > maxBytes) return { ok: false, code: 'TOO_LARGE', message: `Tệp vượt quá ${Math.round(maxBytes / 1024 / 1024)} MB` };
  const head = bytes.subarray(0, 1024).toString('latin1');
  if (!head.includes('%PDF-')) return { ok: false, code: 'NOT_PDF', message: 'Không phải tệp PDF (thiếu chữ ký %PDF-)' };
  if (!bytes.subarray(Math.max(0, bytes.length - 2048)).toString('latin1').includes('%%EOF')) return { ok: false, code: 'CORRUPT', message: 'Tệp PDF bị cắt hoặc hỏng (thiếu %%EOF)' };

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: false });
  } catch (err) {
    const name = (err as Error)?.constructor?.name ?? '';
    if (name.includes('Encrypted') || /encrypt/i.test((err as Error)?.message ?? '')) return { ok: false, code: 'ENCRYPTED', message: 'PDF được mã hóa/đặt mật khẩu — không thể xử lý' };
    return { ok: false, code: 'CORRUPT', message: 'Không đọc được cấu trúc PDF' };
  }
  const pageCount = doc.getPageCount();
  if (pageCount < 1) return { ok: false, code: 'CORRUPT', message: 'PDF không có trang nào' };
  if (pageCount > MAX_PAGES) return { ok: false, code: 'TOO_MANY_PAGES', message: `PDF có ${pageCount} trang, vượt giới hạn ${MAX_PAGES}` };

  const preview = await PDFDocument.create();
  const [first] = await preview.copyPages(doc, [0]);
  preview.addPage(first);
  preview.setTitle('EduCenter preview (page 1)');
  preview.setProducer('EduCenter LOCAL processor');
  const clean = (v: string | undefined) => (v ? [...v].filter((c) => c >= ' ').join('').trim().slice(0, 300) || null : null);
  return {
    ok: true,
    pageCount,
    title: clean(doc.getTitle()),
    author: clean(doc.getAuthor()),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
    preview: Buffer.from(await preview.save()),
  };
}

import QRCode from 'qrcode';
import type { ClassRoom, Student } from '../db/schema';
import { saveFile, safeName } from './files';
import { t, isRTL } from '../i18n';

/** محتوى رمز QR لكل طالب */
export const QR_PREFIX = 'SALAH:';
export const qrPayload = (s: Student) => QR_PREFIX + s.id;
export function parseQr(text: string): string | null {
  const v = text.trim();
  return v.startsWith(QR_PREFIX) ? v.slice(QR_PREFIX.length) : null;
}

export const qrDataUrl = (s: Student, size = 240) => QRCode.toDataURL(qrPayload(s), { errorCorrectionLevel: 'M', margin: 1, width: size });

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const PAGE_W = 794;
const PAGE_H = 1123;
const COLS = 3;
const ROWS = 4;

/** ملف PDF فيه بطاقة QR لكل طالب (12 بطاقة في صفحة A4 للقص) */
export async function exportQrCards(students: Student[], classes: ClassRoom[], org: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  await document.fonts?.ready;
  const cmap = new Map(classes.map((c) => [c.id, c.name]));
  const font = isRTL() ? 'Tajawal' : 'Inter';
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:-10000px;z-index:-1;';
  host.innerHTML = `<style>
.qp{width:${PAGE_W}px;height:${PAGE_H}px;box-sizing:border-box;padding:24px;background:#fff;display:grid;grid-template-columns:repeat(${COLS},1fr);grid-template-rows:repeat(${ROWS},1fr);font-family:${font},system-ui,sans-serif;direction:${isRTL() ? 'rtl' : 'ltr'}}
.qc{border:1px dashed #9aa;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:8px;overflow:hidden}
.qc .o{font-size:11px;color:#0f5132;font-weight:700;margin-bottom:4px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qc img{width:150px;height:150px}
.qc .n{font-size:15px;font-weight:700;color:#111;margin-top:6px;line-height:1.3;max-height:40px;overflow:hidden}
.qc .c{font-size:12px;color:#555;margin-top:2px}
</style>`;
  document.body.appendChild(host);
  try {
    const imgs = await Promise.all(students.map((s) => qrDataUrl(s, 300)));
    const per = COLS * ROWS;
    const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4', compress: true });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    for (let p = 0; p * per < students.length; p++) {
      const page = document.createElement('div');
      page.className = 'qp';
      page.innerHTML = students
        .slice(p * per, (p + 1) * per)
        .map(
          (s, i) => `<div class="qc"><div class="o">${esc(org || t('app_full'))}</div><img src="${imgs[p * per + i]}"/><div class="n">${esc(s.name)}</div><div class="c">${esc(cmap.get(s.classId) ?? '')} · ${t('c_serial')} ${s.serial}</div></div>`,
        )
        .join('');
      host.appendChild(page);
      await Promise.all([...page.querySelectorAll('img')].map((im) => (im.complete ? null : new Promise((r) => (im.onload = r)))));
      const canvas = await html2canvas(page, { scale: 2, backgroundColor: '#ffffff', logging: false });
      if (p > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pw, ph);
      page.remove();
    }
    const b64 = pdf.output('datauristring').split(',')[1];
    await saveFile(b64, safeName(t('qr_file')) + '.pdf', 'application/pdf');
  } finally {
    host.remove();
  }
}

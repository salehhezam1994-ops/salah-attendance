import * as XLSX from 'xlsx';
import type { ReportDoc, DocTable } from './reportDoc';
import { saveFile, safeName } from './files';
import { t, isRTL, locale } from '../i18n';

// ======================= Excel =======================
export function docToWorkbook(doc: ReportDoc): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: isRTL() }] };
  const used = new Set<string>();
  const sheetName = (n: string) => {
    let s = n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || 'Sheet';
    let k = s,
      i = 2;
    while (used.has(k)) k = `${s} ${i++}`;
    used.add(k);
    return k;
  };

  // ورقة الملخص: العنوان + المؤشرات + الجداول الصغيرة
  const summary: (string | number)[][] = [];
  if (doc.org) summary.push([doc.org]);
  summary.push([doc.title], [doc.subtitle], []);
  for (const sec of doc.sections) {
    if (sec.kpis) {
      summary.push([sec.heading]);
      for (const k of sec.kpis) summary.push([k.label, k.value]);
      summary.push([]);
    }
    if (sec.text && !sec.table?.rows.length) summary.push([sec.heading, sec.text], []);
  }
  const ws0 = XLSX.utils.aoa_to_sheet(summary);
  ws0['!cols'] = [{ wch: 28 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws0, sheetName(t('sheet_summary')));

  for (const sec of doc.sections) {
    if (!sec.table || !sec.table.rows.length) continue;
    const ws = tableSheet(sec.table);
    XLSX.utils.book_append_sheet(wb, ws, sheetName(sec.sheet ?? sec.heading));
  }
  return wb;
}

function tableSheet(t: DocTable) {
  const ws = XLSX.utils.aoa_to_sheet([t.head, ...t.rows]);
  ws['!cols'] = t.head.map((h, i) => {
    const max = Math.max(h.length, ...t.rows.map((r) => String(r[i] ?? '').length));
    return { wch: Math.min(45, Math.max(8, max + 2)) };
  });
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: t.rows.length, c: t.head.length - 1 } }) };
  return ws;
}

export async function exportExcel(doc: ReportDoc) {
  const wb = docToWorkbook(doc);
  const b64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
  await saveFile(b64, safeName(doc.fileBase) + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// ======================= PDF =======================
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const PAGE_W = 794; // A4 @96dpi
const PAGE_H = 1123;
const PAD = 40;

function rateClass(v: unknown) {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (isNaN(n)) return '';
  return n >= 90 ? 'g' : n >= 70 ? 'y' : 'r';
}

function rowHTML(t: DocTable, r: DocTable['rows'][number]) {
  return `<tr>${r
    .map((c, i) => {
      let cls = '';
      if (t.rateCols?.includes(i)) cls = rateClass(c);
      else if (t.absentCols?.includes(i) && Number(c) > 0) cls = 'r';
      return `<td class="${cls}">${esc(c)}</td>`;
    })
    .join('')}</tr>`;
}

function tableHTML(t: DocTable, rows = t.rows) {
  return `<table class="t"><thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => rowHTML(t, r)).join('')}</tbody></table>`;
}

const pdfCss = () => `
.pp{width:${PAGE_W}px;height:${PAGE_H}px;padding:${PAD}px;box-sizing:border-box;background:#fff;color:#1b1f1d;direction:${isRTL() ? 'rtl' : 'ltr'};font-family:${isRTL() ? 'Tajawal' : 'Inter'},system-ui,sans-serif;position:relative;overflow:hidden}
.pp h1{font-size:22px;margin:0 0 4px;color:#0f5132}
.pp .org{font-size:13px;color:#555;margin-bottom:2px}
.pp .sub{font-size:13px;color:#444;margin-bottom:14px;border-bottom:2px solid #0f5132;padding-bottom:10px}
.pp h2{font-size:15px;margin:14px 0 8px;color:#0f5132}
.pp .k{display:flex;flex-wrap:wrap;gap:8px}
.pp .k div{border:1px solid #d6e2dc;border-radius:8px;padding:8px 12px;min-width:120px;background:#f6faf8}
.pp .k b{display:block;font-size:18px}
.pp .k span{font-size:11px;color:#555}
.pp .k .ok b{color:#157347}.pp .k .bad b{color:#b02a37}
.pp .t{width:100%;border-collapse:collapse;font-size:11.5px}
.pp .t th{background:#0f5132;color:#fff;padding:6px 5px;font-weight:700}
.pp .t td{border-bottom:1px solid #e3e7e5;padding:5px;text-align:center}
.pp .t td:nth-child(2){white-space:nowrap;text-align:start}
.pp .t tr:nth-child(even) td{background:#f7f9f8}
.pp .t td.g{color:#157347;font-weight:700}.pp .t td.y{color:#9a6700;font-weight:700}.pp .t td.r{color:#b02a37;font-weight:700}
.pp .txt{font-size:13px;color:#333}
.pp .ft{position:absolute;bottom:16px;left:${PAD}px;right:${PAD}px;font-size:10px;color:#888;display:flex;justify-content:space-between}
`;

/** تقسيم التقرير إلى صفحات A4 دون قطع الصفوف، مع تكرار رأس الجدول */
function paginate(doc: ReportDoc, host: HTMLElement): HTMLElement[] {
  const pages: HTMLElement[] = [];
  let page!: HTMLElement;
  const limit = PAGE_H - PAD - 40; // مساحة للتذييل
  const newPage = () => {
    page = document.createElement('div');
    page.className = 'pp';
    host.appendChild(page);
    pages.push(page);
  };
  const fits = () => page.lastElementChild ? (page.lastElementChild as HTMLElement).offsetTop + (page.lastElementChild as HTMLElement).offsetHeight <= limit : true;
  const add = (html: string) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const el = tmp.firstElementChild as HTMLElement;
    page.appendChild(el);
    if (!fits() && page.children.length > 1) {
      page.removeChild(el);
      newPage();
      page.appendChild(el);
    }
    return el;
  };
  newPage();
  page.style.position = 'relative';
  add(`<div>${doc.org ? `<div class="org">${esc(doc.org)}</div>` : ''}<h1>${esc(doc.title)}</h1><div class="sub">${esc(doc.subtitle)}</div></div>`);
  for (const sec of doc.sections) {
    const h = add(`<h2>${esc(sec.heading)}</h2>`);
    if (sec.kpis) {
      const k = add(`<div class="k">${sec.kpis.map((k) => `<div class="${k.tone ?? ''}"><b>${esc(k.value)}</b><span>${esc(k.label)}</span></div>`).join('')}</div>`);
      if (k.parentElement !== h.parentElement) moveBefore(h, k);
    }
    if (sec.text && !sec.table?.rows.length) add(`<div class="txt">${esc(sec.text)}</div>`);
    if (sec.table && sec.table.rows.length) {
      let rows = sec.table.rows;
      let first = true;
      while (rows.length) {
        // أضف الجدول صفًا صفًا حتى يمتلئ
        const tEl = add(tableHTML(sec.table, [rows[0]]));
        if (first && tEl.parentElement !== h.parentElement) moveBefore(h, tEl);
        first = false;
        const tbody = tEl.querySelector('tbody')!;
        let i = 1;
        for (; i < rows.length; i++) {
          const tmp = document.createElement('tbody');
          tmp.innerHTML = rowHTML(sec.table, rows[i]);
          const tr = tmp.firstElementChild as HTMLElement;
          tbody.appendChild(tr);
          if (!fits()) {
            tbody.removeChild(tr);
            break;
          }
        }
        rows = rows.slice(i);
        if (rows.length) newPage();
      }
    }
  }
  const now = new Date();
  pages.forEach((p, i) => {
    const f = document.createElement('div');
    f.className = 'ft';
    f.innerHTML = `<span>${esc(t('pdf_footer', { date: now.toLocaleDateString(locale()) }))}</span><span>${esc(t('page_of', { i: i + 1, n: pages.length }))}</span>`;
    p.appendChild(f);
  });
  return pages;
}

/** ينقل العنوان إلى الصفحة الجديدة حتى لا يبقى وحيدًا أسفل الصفحة السابقة */
function moveBefore(h: HTMLElement, el: HTMLElement) {
  el.parentElement!.insertBefore(h, el);
}

export async function exportPdf(doc: ReportDoc) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  await document.fonts?.ready;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:-10000px;z-index:-1;';
  const style = document.createElement('style');
  style.textContent = pdfCss();
  host.appendChild(style);
  document.body.appendChild(host);
  try {
    const pages = paginate(doc, host);
    const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4', compress: true });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pw, ph);
    }
    const b64 = pdf.output('datauristring').split(',')[1];
    await saveFile(b64, safeName(doc.fileBase) + '.pdf', 'application/pdf');
  } finally {
    host.remove();
  }
}

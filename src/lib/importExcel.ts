import * as XLSX from 'xlsx';
import { saveFile } from './files';

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
  guess: { name: number; serial: number; phone: number; className: number };
}

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

export async function parseExcel(file: File): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][]).map((r) => r.map(norm));
  const nonEmpty = aoa.filter((r) => r.some((c) => c));
  if (!nonEmpty.length) return { headers: [], rows: [], guess: { name: -1, serial: -1, phone: -1, className: -1 } };

  // البحث عن صف العناوين في أول 10 صفوف
  let hi = -1;
  for (let i = 0; i < Math.min(10, nonEmpty.length); i++) {
    if (nonEmpty[i].some((c) => /اسم|الاسم|name/i.test(c))) {
      hi = i;
      break;
    }
  }
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const headers = hi >= 0 ? Array.from({ length: width }, (_, i) => nonEmpty[hi][i] || `عمود ${i + 1}`) : Array.from({ length: width }, (_, i) => `عمود ${i + 1}`);
  const rows = nonEmpty.slice(hi + 1);

  const find = (re: RegExp) => headers.findIndex((h) => re.test(h));
  let name = find(/اسم|name/i);
  if (name < 0) {
    // العمود الذي يحتوي أطول نصوص عربية
    let best = 0,
      bi = 0;
    for (let c = 0; c < width; c++) {
      const score = rows.slice(0, 20).reduce((a, r) => a + (/[؀-ۿ]{2,}\s+[؀-ۿ]{2,}/.test(r[c] ?? '') ? 1 : 0), 0);
      if (score > best) (best = score), (bi = c);
    }
    name = bi;
  }
  const guess = {
    name,
    serial: find(/^م$|رقم|تسلسل|الرقم|serial|no\.?$|#/i),
    phone: find(/جوال|هاتف|موبايل|تلفون|phone|mobile/i),
    className: find(/الصف|صف|الفصل|فصل|class/i),
  };
  if (guess.serial === guess.phone) guess.serial = -1;
  return { headers, rows, guess };
}

export async function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['الرقم', 'اسم الطالب', 'الصف', 'الجوال'],
    [1, 'محمد أحمد العلي', 'الصف الأول', '0500000000'],
    [2, 'عبدالله سعد الحربي', 'الصف الأول', ''],
    [3, 'خالد ناصر القحطاني', 'الصف الثاني', ''],
  ]);
  ws['!cols'] = [{ wch: 8 }, { wch: 32 }, { wch: 16 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'الطلاب');
  await saveFile(XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }), 'نموذج_استيراد_الطلاب.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

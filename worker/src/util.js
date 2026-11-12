export const STAGES = ['ยังไม่ออกดอก', 'ดอกบาน', 'ผลเล็ก', 'พร้อมตัด', 'หมด/ปิดรุ่น'];
const TM = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const BKK = 7 * 3600e3;

/** postback data <-> object (LINE จำกัด 300 ตัวอักษร) */
export const pb = (o) => new URLSearchParams(o).toString();
export const parsePb = (s) => Object.fromEntries(new URLSearchParams(s || ''));

const bkk = (iso) => new Date(new Date(iso).getTime() + BKK);
const valid = (iso) => iso && !isNaN(new Date(iso));

/** "15 มี.ค." */
export function thaiShort(iso) {
  if (!valid(iso)) return '-';
  const d = bkk(iso);
  return `${d.getUTCDate()} ${TM[d.getUTCMonth()]}`;
}

/** "ปลาย พ.ค." */
export function period(iso) {
  if (!valid(iso)) return '-';
  const d = bkk(iso), dd = d.getUTCDate();
  return `${dd <= 10 ? 'ต้น' : dd <= 20 ? 'กลาง' : 'ปลาย'} ${TM[d.getUTCMonth()]}`;
}

export function daysAgo(iso) {
  if (!valid(iso)) return 999;
  const a = bkk(new Date().toISOString()), b = bkk(iso);
  const day = (x) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  return Math.round((day(a) - day(b)) / 864e5);
}

export function ago(iso) {
  const n = daysAgo(iso);
  return n <= 0 ? 'วันนี้' : n === 1 ? 'เมื่อวาน' : n >= 999 ? '-' : `${n} วันก่อน`;
}

export const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** ข้อความธรรมดา + ปุ่มตอบด่วน (สูงสุด 13 ปุ่ม, ป้ายไม่เกิน 20 ตัวอักษร) */
export function text(t, quick) {
  const m = { type: 'text', text: cut(t || '-', 5000) };
  if (quick && quick.length) m.quickReply = quickReply(quick);
  return m;
}

export function quickReply(items) {
  return {
    items: items.slice(0, 13).map(([label, data, display]) => ({
      type: 'action',
      action: data.startsWith('https://') || data.startsWith('tel:')
        ? { type: 'uri', label: cut(label, 20), uri: data }
        : { type: 'postback', label: cut(label, 20), data, displayText: cut(display || label, 300) }
    }))
  };
}

/** ล็อตมีของให้ขายหรือจอง: ผลเล็ก/พร้อมตัด และยังเหลือ */
export const has = (l) => (l.stage === 2 || l.stage === 3) && l.remaining > 0;

/** รุ่นหลักที่แสดงให้ลูกค้า + รุ่นถัดไป */
export function primary(lots) {
  const open = lots.filter((l) => l.stage < 4);
  if (!open.length) return { p: lots[lots.length - 1] || null, nx: null };
  open.sort((a, b) => ((b.stage === 3 && b.remaining > 0) - (a.stage === 3 && a.remaining > 0)) || (b.stage - a.stage));
  return { p: open[0], nx: open[1] || null };
}

export function statText(l) {
  if (!l) return '-';
  if (l.stage === 3 && l.remaining > 0) return `พร้อมตัด คงเหลือ ~${l.remaining} ลูก`;
  if (l.stage === 2 && l.remaining > 0) return `ผลเล็ก เปิดจอง ~${l.remaining} ลูก${l.harvest_from ? ' คาดตัด ' + period(l.harvest_from) : ''}`;
  if (l.stage === 2) return `ผลเล็ก${l.harvest_from ? ' คาดตัด ' + period(l.harvest_from) : ''}`;
  if (l.stage === 1) return `ดอกบาน${l.harvest_from ? ' คาดตัด ' + period(l.harvest_from) : ''}`;
  if (l.stage === 0) return 'ยังไม่ออกดอก';
  return 'หมดรอบนี้';
}

export const json = (o, status = 200, headers = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

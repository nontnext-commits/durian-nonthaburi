/**
 * ทดสอบแบบจำลองทั้งระบบโดยไม่ต้องต่ออินเทอร์เน็ต:
 *  - รันโค้ด Apps Script จริง (../apps-script/*.gs) บน Google Sheets จำลองในหน่วยความจำ
 *  - ยิง LINE webhook จำลอง (มีลายเซ็นจริง) เข้า Worker
 *  - จำลอง LINE API, Cloudinary, AI
 * รัน: node test/mock-test.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gasDir = path.join(here, '..', '..', 'apps-script');

/* ---------- Google Sheets จำลอง ---------- */
class Range {
  constructor(sh, r, c, nr = 1, nc = 1) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j)); out.push(row); } return out; }
  setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this; }
  setValue(x) { this.sh.set(this.r, this.c, x); return this; }
  setFontWeight() { return this; } setBackground() { return this; } setDataValidation() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.d = []; }
  get(r, c) { return (this.d[r - 1] || [])[c - 1] ?? ''; }
  set(r, c, v) { while (this.d.length < r) this.d.push([]); this.d[r - 1][c - 1] = v; }
  getLastRow() { return this.d.filter((r) => r.some((x) => x !== '' && x !== undefined)).length; }
  getLastColumn() { return Math.max(0, ...this.d.map((r) => r.length)); }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
  appendRow(v) { this.d.push(v.slice()); }
  setFrozenRows() {}
}
const sheets = new Map();
const ss = {
  getSheetByName: (n) => sheets.get(n) || null,
  insertSheet: (n) => { const s = new Sheet(n); sheets.set(n, s); return s; },
  getSheets: () => [...sheets.values()],
  deleteSheet: (s) => sheets.delete(s.name)
};
const chain = new Proxy({}, { get: (t, k) => (k === 'build' ? () => ({}) : () => chain) });
const props = { API_SECRET: 'test-secret', OFFICER_EMAILS: 'officer@example.com' };
const mails = [];
const gasCtx = vm.createContext({
  SpreadsheetApp: { getActive: () => ss, newDataValidation: () => chain },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }) },
  MailApp: { sendEmail: (...a) => mails.push(a) },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => chain },
  Logger: { log() {} },
  console, Date, JSON, Math, String, Number, Object, Array, Error, isNaN, parseInt
});
for (const f of ['Config.gs', 'Db.gs', 'Setup.gs', 'Api.gs']) {
  vm.runInContext(fs.readFileSync(path.join(gasDir, f), 'utf8').replace(/^const /gm, 'var '), gasCtx, { filename: f });
}
vm.runInContext('setupDatabase()', gasCtx);
vm.runInContext(`appendObj('users',{line_user_id:'Uofficer',role:'officer',display_name:'จนท. วิภา',added_at:new Date(),via:'manual'})`, gasCtx);

/* ---------- บริการภายนอกจำลอง ---------- */
const env = {
  GAS_URL: 'https://script.google.com/macros/s/TEST/exec', GAS_SECRET: 'test-secret',
  LINE_FARMER_SECRET: 'fs', LINE_FARMER_TOKEN: 'ft', LINE_CUSTOMER_SECRET: 'cs', LINE_CUSTOMER_TOKEN: 'ct',
  LINE_LOGIN_CHANNEL_ID: '123', LIFF_REGISTER_ID: 'liff-reg', LIFF_TABLE_ID: 'liff-tab', WEB_URL: 'https://example.github.io/web/',
  CLOUDINARY_CLOUD: 'demo', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's', ANTHROPIC_API_KEY: 'a', AI_PROVIDER: 'anthropic'
};
const kv = new Map();
env.DATA = {
  get: async (k, t) => (kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null),
  put: async (k, v) => { kv.set(k, v); },
  delete: async (k) => { kv.delete(k); },
  list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) })
};
const replies = [];
let aiPrompt = '';
let photoN = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const ok = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u === env.GAS_URL) {
    gasCtx.__body = opts.body;
    return new Response(vm.runInContext('doPost({postData:{contents:__body}}).content', gasCtx));
  }
  if (u.endsWith('/v2/bot/message/reply')) { replies.push(JSON.parse(opts.body)); return ok({}); }
  if (u.includes('/chat/loading/start')) return ok({});
  if (u.includes('api-data.line.me')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
  if (u.includes('/v2/bot/profile/')) return ok({ displayName: 'ผู้ใช้ทดสอบ' });
  if (u.includes('/oauth2/v2.1/verify')) { const tok = new URLSearchParams(opts.body).get('id_token'); return ok({ sub: tok, name: 'ลุงทดสอบ' }); }
  if (u.includes('api.cloudinary.com')) return ok({ public_id: `durian/p${++photoN}`, image_metadata: { GPSLatitude: "13 deg 51' 0.00\" N", GPSLongitude: "100 deg 28' 12.00\" E", DateTimeOriginal: '2027:03:15 09:14:00' } });
  if (u.includes('api.anthropic.com')) { aiPrompt = JSON.parse(opts.body).messages[0].content; return ok({ content: [{ type: 'text', text: 'ตอนนี้สวนทดสอบมีหมอนทองพร้อมตัดครับ ราคาแต่ละสวนกำหนดเอง กดติดต่อสวนบนการ์ดได้เลยครับ' }] }); }
  throw new Error('unexpected fetch ' + u);
};

const worker = (await import('../src/index.js')).default;
const sign = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest('base64');
async function hook(channel, ev) {
  const body = JSON.stringify({ events: [{ replyToken: 'r' + Math.random(), timestamp: Date.now(), ...ev }] });
  const pending = [];
  const res = await worker.fetch(new Request(`https://w.test/webhook/${channel}`, {
    method: 'POST', body, headers: { 'x-line-signature': sign(body, channel === 'farmer' ? 'fs' : 'cs') }
  }), env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  if (res.status !== 200) throw new Error('webhook ' + res.status);
  return replies.length ? replies[replies.length - 1].messages : [];
}
async function api(pathname, body) {
  const pending = [];
  const r = await worker.fetch(new Request('https://w.test' + pathname, { method: 'POST', body: JSON.stringify(body) }), env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return r.json();
}
const txt = (m) => m.map((x) => x.type === 'text' ? x.text : `[flex: ${x.altText}]`).join(' | ');
const qr = (m) => (m.find((x) => x.quickReply) || { quickReply: { items: [] } }).quickReply.items.map((i) => i.action);
const tap = (m, label) => {
  const a = qr(m).find((x) => x.label.includes(label));
  if (!a) throw new Error(`ไม่พบปุ่ม "${label}" ใน [${qr(m).map((x) => x.label)}]`);
  return a.data;
};
const F = (text) => ({ type: 'message', source: { userId: 'Ufarmer' }, message: { type: 'text', id: 'm' + Math.random(), text } });
const FP = (data) => ({ type: 'postback', source: { userId: 'Ufarmer' }, postback: { data } });
const C = (text) => ({ type: 'message', source: { userId: 'Ucust' }, message: { type: 'text', id: 'm' + Math.random(), text } });
const CP = (data) => ({ type: 'postback', source: { userId: 'Ucust' }, postback: { data } });
const OP = (data) => ({ type: 'postback', source: { userId: 'Uofficer' }, postback: { data } });
let step = 0;
const log = (title, m) => console.log(`\n${++step}. ${title}\n   ${typeof m === 'string' ? m : txt(m)}${Array.isArray(m) && qr(m).length ? '\n   ปุ่ม: ' + qr(m).map((x) => x.label).join(' / ') : ''}`);
const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT: ' + msg); };

/* ---------- สถานการณ์ทดสอบ ---------- */
let m = await hook('farmer', F('สวัสดี'));
log('เกษตรกรยังไม่ลงทะเบียน ทักบอท', m);
assert(txt(m).includes('liff.line.me/liff-reg'), 'ต้องได้ลิงก์ลงทะเบียน');

let r = await api('/api/register', { idToken: 'Ufarmer', form: { farm_name: 'สวนทดสอบ', owner_name: 'ลุงทดสอบ', tambon: 'ต.บางกร่าง', phone: '081-234-5678', lat: 13.85, lng: 100.47, pdpa: true, show_phone: true, accepts_booking: true, varieties: [{ variety: 'หมอนทอง', trees: 20 }, { variety: 'ก้านยาว', trees: 10 }, { variety: 'ลวง', trees: 2 }] } });
log('ลงทะเบียนผ่าน LIFF', JSON.stringify(r));
assert(r.farm_id === 'DUR-001' && r.invite_code, 'ต้องได้รหัสสวนและรหัสเชิญ');

m = await hook('farmer', { type: 'message', source: { userId: 'Ukid' }, message: { type: 'text', id: 'x', text: r.invite_code } });
log('ลูกหลานใช้รหัสเชิญ', m);
assert(txt(m).includes('ผูกบัญชีกับ สวนทดสอบ'), 'ต้องผูกบัญชีลูกหลานได้');

m = await hook('farmer', OP('a=pending'));
log('เจ้าหน้าที่เปิดสวนรอยืนยัน', m);
m = await hook('farmer', OP('a=ofv&f=DUR-001&d=verified'));
log('เจ้าหน้าที่กดยืนยัน', m);

m = await hook('farmer', F('สวนของฉัน'));
log('เกษตรกรเปิดสวนของฉัน (มีแจ้งผลยืนยัน)', m);
assert(txt(m).includes('ได้รับการยืนยัน'), 'ต้องแจ้งผลการยืนยันครั้งแรก');

m = await hook('farmer', F('ดอกบาน'));
m = await hook('farmer', FP(tap(m, 'หมอนทอง')));
log('กดดอกบาน > หมอนทอง', m);
assert(txt(m).includes('เริ่ม หมอนทอง'), 'สร้างรุ่นแรกจากล็อตที่ยังไม่ออกดอก');

m = await hook('farmer', F('ดอกบาน'));
m = await hook('farmer', FP(tap(m, 'หมอนทอง')));
log('ดอกบานอีกครั้ง (มีรุ่นอยู่แล้ว)', m);
m = await hook('farmer', FP(tap(m, 'ใช่ รุ่นใหม่')));
log('ยืนยันรุ่นใหม่', m);
assert(txt(m).includes('หมอนทอง รุ่น 2'), 'ต้องเป็นรุ่น 2');

for (const i of [1, 2]) m = await hook('farmer', { type: 'message', source: { userId: 'Ufarmer' }, message: { type: 'image', id: 'img' + i, imageSet: { id: 's1', index: i, total: 2 } } });
log('ส่งรูป 2 รูป', m);
m = await hook('farmer', FP(tap(m, 'หมอนทอง')));
m = await hook('farmer', FP(tap(m, 'ผลเล็ก')));
log('รูปหมอนทอง ระยะผลเล็ก (ยังไม่มีรุ่นผลเล็ก)', m);
m = await hook('farmer', FP(tap(m, 'รุ่น 1')));
m = await hook('farmer', FP(tap(m, '~50')));
log('เลือกรุ่น 1 เลื่อนเป็นผลเล็ก ~50 ลูก', m);
assert(txt(m).includes('รูปจะขึ้นไทม์ไลน์'), 'ต้องแนบรูป');

m = await hook('farmer', F('ขาย/จองแล้ว'));
log('ขาย/จองแล้ว', m);
m = await hook('farmer', FP(tap(m, '5')));
log('ขายไป 5 ลูก', m);
assert(txt(m).includes('คงเหลือ 45'), 'สต็อกต้องลดเหลือ 45');

const mf = await api('/api/myfarm', { idToken: 'Ufarmer' });
const kan = mf.lots.find((l) => l.variety === 'ก้านยาว');
r = await api('/api/table', { idToken: 'Ukid', items: [{ lot_id: kan.lot_id, stage: 3, remaining: 12 }] });
log('ลูกหลานอัปเดตจากหน้าตาราง', JSON.stringify(r));

await worker.scheduled({}, env, { waitUntil: async (p) => p });
await new Promise((res) => setTimeout(res, 50));
m = await hook('customer', { type: 'follow', source: { userId: 'Ucust' } });
log('ลูกค้าเพิ่มเพื่อน', m);
m = await hook('customer', C('สวนที่มีผลผลิต'));
m = await hook('customer', CP(tap(m, 'หมอนทอง')));
log('ค้นหาหมอนทอง', m);
const card = m.find((x) => x.type === 'flex').contents.contents[0];
const bodyText = JSON.stringify(card.body);
assert(bodyText.includes('รุ่นถัดไป'), 'การ์ดต้องบอกรุ่นถัดไป');
const leadBtn = card.footer.contents.find((b) => b.action.label === 'ติดต่อสวน');
m = await hook('customer', CP(leadBtn.action.data));
log('ลูกค้ากดติดต่อสวน', m);
m = await hook('customer', CP('a=fol&f=DUR-001&v=' + encodeURIComponent('ลวง')));
m = await hook('customer', C('สวนที่ติดตาม'));
log('ติดตามลวง แล้วเปิดสวนที่ติดตาม', m);
m = await hook('customer', C('อยากได้หมอนทอง 2 ลูก ราคาเท่าไร'));
log('ลูกค้าถาม AI', m);
assert(aiPrompt.includes('สวนทดสอบ') && aiPrompt.includes('หมอนทอง'), 'AI ต้องได้รับข้อมูลสวนจริง');

m = await hook('farmer', F('สวนของฉัน'));
log('เกษตรกรทักบอทหลังมีลูกค้าติดต่อ', m);
assert(txt(m).includes('มีลูกค้าติดต่อไป 1 ราย'), 'ต้องถามผล lead');
m = await hook('farmer', FP(tap(m, 'ยังไม่ได้ขาย')));
log('ตอบยังไม่ได้ขาย', m);

const rows = (n) => vm.runInContext(`readAll('${n}').length`, gasCtx);
console.log(`\nข้อมูลในชีต: farms=${rows('farms')} lots=${rows('lots')} stage_updates=${rows('stage_updates')} users=${rows('users')} leads=${rows('leads')} follows=${rows('follows')}`);
const ups = vm.runInContext(`JSON.stringify(readAll('stage_updates').filter(u=>u.photo_urls).map(u=>[u.photo_urls,u.photo_lat,u.photo_lng]))`, gasCtx);
console.log('รูปที่บันทึก:', ups);
assert(ups.includes('13.85') && ups.includes('p1.jpg') && ups.includes('p2.jpg'), 'ต้องเก็บรูปทั้ง 2 รูปพร้อมพิกัด');
console.log('\nผ่านทุกขั้นตอน ✓');

/* ---------- ตรวจข้อจำกัดข้อความของ LINE ทุกข้อความที่ตอบ ---------- */
const problems = [];
const walk = (o, where) => {
  if (Array.isArray(o)) return o.forEach((x, i) => walk(x, where + '[' + i + ']'));
  if (!o || typeof o !== 'object') return;
  if (o.type === 'text' && (typeof o.text !== 'string' || !o.text.trim())) problems.push(where + ' ข้อความว่าง');
  if (o.label !== undefined && [...o.label].length > 20) problems.push(where + ' ป้ายยาวเกิน 20: ' + o.label);
  if (o.type === 'postback' && Buffer.byteLength(o.data) > 300) problems.push(where + ' postback เกิน 300 ไบต์');
  if (o.type === 'uri' && !/^(https:|tel:)/.test(o.uri)) problems.push(where + ' uri ไม่ถูกต้อง: ' + o.uri);
  if (o.type === 'image' && !/^https:/.test(o.url)) problems.push(where + ' รูปต้องเป็น https');
  if (o.quickReply && o.quickReply.items.length > 13) problems.push(where + ' ปุ่มตอบด่วนเกิน 13');
  Object.entries(o).forEach(([k, v]) => walk(v, where + '.' + k));
};
replies.forEach((r, i) => { if (r.messages.length > 5) problems.push(`reply ${i} เกิน 5 ข้อความ`); walk(r.messages, 'reply' + i); });
console.log(problems.length ? 'พบปัญหา:\n' + problems.join('\n') : `ตรวจข้อจำกัด LINE ${replies.length} ข้อความตอบกลับ: ผ่าน ✓`);
if (problems.length) process.exit(1);

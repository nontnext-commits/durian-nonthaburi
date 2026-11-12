/** บัญชี LINE OA ลูกค้า */
import { reply, loading, profile } from './line.js';
import { gas, getSnap } from './gas.js';
import { askAI, SYSTEM_PROMPT } from './ai.js';
import { farmCard, contactCard, carousel } from './flex.js';
import { pb, parsePb, text, has, primary, statText, ago } from './util.js';

const CMDS = { 'สวนที่มีผลผลิต': 'find', 'ค้นหาสวน': 'find', 'สวนที่ติดตาม': 'fols', 'พันธุ์โบราณ': 'her', 'วิธีใช้': 'help', 'เมนู': 'help' };
const DAILY_AI_LIMIT = 30;

export async function handleCustomer(env, ev) {
  const userId = ev.source && ev.source.userId;
  if (!userId || !ev.replyToken) return;
  const token = env.LINE_CUSTOMER_TOKEN;
  const send = (...msgs) => reply(token, ev.replyToken, msgs.flat());
  const MENU = [['สวนที่มีผลผลิต', pb({ a: 'find' })], ['พันธุ์โบราณ/หายาก', pb({ a: 'her' })], ['สวนที่ติดตาม', pb({ a: 'fols' })]];

  let cmd = null, p = {};
  if (ev.type === 'follow') cmd = 'follow';
  else if (ev.type === 'postback') { p = parsePb(ev.postback.data); cmd = p.a; }
  else if (ev.type === 'message' && ev.message.type === 'text') cmd = CMDS[ev.message.text.trim()] || 'ai';
  else if (ev.type === 'message') return send(text('พิมพ์ถามหรือกดเมนูด้านล่างได้เลยครับ', MENU));
  else return;

  const snap = await getSnap(env);
  const farms = snap.farms || [];
  const farmOf = (id) => farms.find((f) => f.farm_id === id);
  const lotsOf = (fid, v) => (snap.lots || []).filter((l) => l.farm_id === fid && l.variety === v);
  const popular = (snap.varieties || []).filter((v) => v.group === 'popular').map((v) => v.variety);
  const heritage = (snap.varieties || []).filter((v) => v.group !== 'popular').map((v) => v.variety);

  /** สวนที่ปลูกพันธุ์ v เรียง: มีของ > พร้อมตัด > ระยะ > อัปเดตล่าสุด */
  const results = (v) => farms.filter((f) => lotsOf(f.farm_id, v).length).map((f) => ({ f, v, ...primary(lotsOf(f.farm_id, v)) }))
    .filter((x) => x.p)
    .sort((a, b) => (has(b.p) - has(a.p)) || ((b.p.stage === 3) - (a.p.stage === 3)) || (b.p.stage - a.p.stage) ||
      (new Date(b.p.updated_at) - new Date(a.p.updated_at)));
  const cards = (list) => carousel('สวนทุเรียนนนท์', list.slice(0, 10).map((x) => farmCard(env, x.f, x.v, x.p, x.nx)));

  switch (cmd) {
    case 'follow': {
      const prof = await profile(token, userId);
      await gas(env, 'customer', { userId, displayName: prof.displayName }).catch((e) => console.error(e));
      return send(text('ยินดีต้อนรับสู่ทุเรียนนนท์ครับ ค้นหาสวนที่สำนักงานเกษตรอำเภอยืนยันแล้ว ดูรูปพัฒนาการจริงของแต่ละสวน แล้วติดต่อสวนได้โดยตรง\n\nกดเมนูหรือพิมพ์ถามได้เลยครับ เช่น "อยากได้ก้านยาว 2 ลูก"', MENU));
    }
    case 'find':
      return send(text('ต้องการพันธุ์ไหนครับ', [...popular.map((v) => [v, pb({ a: 'fv', v })]), ['พันธุ์โบราณ/หายาก ›', pb({ a: 'her' })]]));
    case 'her':
      return send(text('พันธุ์ดั้งเดิมของนนท์ มีจำนวนน้อย ควรจองล่วงหน้าครับ', heritage.map((v) => [v, pb({ a: 'fv', v })])));
    case 'fv': {
      const r = results(p.v);
      if (!r.length) return send(text(`ตอนนี้ยังไม่มีสวนที่ยืนยันแล้วปลูก${p.v}ครับ เข้ากลุ่ม OpenChat รอประกาศได้`, MENU));
      const n = r.filter((x) => has(x.p)).length;
      return send(text(n ? `มี ${n} สวนที่มี${p.v}พร้อมตัดหรือเปิดจองครับ` : `${p.v}ยังไม่มีของพร้อมขาย กด "ติดตามสวน" ไว้แล้วกลับมาดูความคืบหน้าได้ครับ`), cards(r));
    }
    case 'fols': {
      const list = await gas(env, 'follows', { customerId: userId });
      const r = list.map((x) => ({ f: farmOf(x.farm_id), v: x.variety })).filter((x) => x.f)
        .map((x) => ({ ...x, ...primary(lotsOf(x.f.farm_id, x.v)) })).filter((x) => x.p);
      if (!r.length) return send(text('ยังไม่ได้ติดตามสวนไหนครับ กดปุ่ม "ติดตามสวน" บนการ์ดสวนได้เลย', MENU));
      return send(text('สถานะล่าสุดของสวนที่ติดตามครับ'), cards(r));
    }
    case 'fol':
      await gas(env, 'follow', { customerId: userId, farmId: p.f, variety: p.v });
      return send(text('ติดตามแล้วครับ กดเมนู "สวนที่ติดตาม" เพื่อดูรูปและสถานะล่าสุดได้ตลอด', MENU));
    case 'lead': {
      const farm = await gas(env, 'lead', { customerId: userId, farmId: p.f, variety: p.v, lotId: p.l, channel: 'card' });
      return send(contactCard(farm));
    }
    case 'help':
      return send(text('กดเมนูเพื่อค้นหาสวนตามพันธุ์ หรือพิมพ์ถามได้เลยครับ เช่น "มีหมอนทองพร้อมตัดไหม" หรือ "พันธุ์โบราณมีอะไรบ้าง"', MENU));
    case 'ai':
      return send(await aiAnswer(env, userId, ev.message.text, snap, results, cards, MENU));
    default:
      return send(text('กดเมนูด้านล่างได้เลยครับ', MENU));
  }
}

/** นับจำนวนคำถาม AI ต่อคนต่อวัน ด้วย Cache API (ไม่ใช้โควตาเขียน KV) */
async function bump(env, key) {
  if (typeof caches === 'undefined' || !caches.default) { // สำรอง: ใช้ KV
    const n = (Number(await env.DATA.get(key)) || 0) + 1;
    await env.DATA.put(key, String(n), { expirationTtl: 172800 });
    return n;
  }
  const req = new Request('https://ratelimit.internal/' + encodeURI(key));
  const hit = await caches.default.match(req);
  const n = (hit ? Number(await hit.text()) || 0 : 0) + 1;
  await caches.default.put(req, new Response(String(n), { headers: { 'cache-control': 'max-age=172800' } }));
  return n;
}

async function aiAnswer(env, userId, q, snap, results, cards, MENU) {
  const day = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const used = await bump(env, `rl/${userId}/${day}`);
  if (used > DAILY_AI_LIMIT) return [text('วันนี้ถามครบจำนวนแล้วครับ ค้นหาสวนจากเมนูด้านล่างได้ตลอดครับ', MENU)];
  await loading(env.LINE_CUSTOMER_TOKEN, userId, 20);

  const all = (snap.varieties || []).map((v) => v.variety);
  let wanted = all.filter((v) => q.includes(v));
  if (!wanted.length && /โบราณ|หายาก|ดั้งเดิม/.test(q)) wanted = (snap.varieties || []).filter((v) => v.group !== 'popular').map((v) => v.variety);
  if (!wanted.length) wanted = all;

  const cand = wanted.flatMap((v) => results(v)).filter((x) => x.p.stage >= 1)
    .sort((a, b) => (has(b.p) - has(a.p)) || (b.p.stage - a.p.stage)).slice(0, 12);
  const data = cand.length ? cand.map((x) =>
    `- ${x.f.farm_name} (${x.f.tambon}) | พันธุ์ ${x.v} | ${statText(x.p)}${x.nx ? ' | รุ่นถัดไป: ' + statText(x.nx) : ''} | อัปเดต ${ago(x.p.updated_at)}` +
    `${x.f.story ? ' | เรื่องเล่า: ' + String(x.f.story).slice(0, 160) : ''}`).join('\n') : '(ไม่มีสวนที่ตรงเงื่อนไข)';

  try {
    const ans = await askAI(env, SYSTEM_PROMPT, `ข้อมูลสวน (อัปเดตทุก 5 นาที):\n${data}\n\nคำถามลูกค้า: ${q}`);
    const top = cand.filter((x) => has(x.p)).slice(0, 3);
    return [text(ans || 'ขออภัยครับ ลองถามใหม่หรือกดเมนูด้านล่างได้เลยครับ', MENU), top.length ? cards(top) : null];
  } catch (e) {
    console.error(e);
    return [text('ตอนนี้ระบบตอบอัตโนมัติขัดข้อง ค้นหาสวนจากเมนูด้านล่างได้เลยครับ', MENU)];
  }
}

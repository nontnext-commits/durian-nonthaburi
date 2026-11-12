/** บัญชี LINE OA เกษตรกร (รวมเมนูเจ้าหน้าที่) */
import { reply, getContent, profile } from './line.js';
import { gas, refreshSnap } from './gas.js';
import { upload } from './cloudinary.js';
import { mineCards, officerCards } from './flex.js';
import { STAGES, pb, parsePb, text, has, thaiShort, period, cut } from './util.js';

const CMDS = {
  'สวนของฉัน': 'mine', 'ดอกบาน': 'bloom', 'ขาย/จองแล้ว': 'sell', 'ขายจองแล้ว': 'sell', 'ขายแล้ว': 'sell',
  'อัปเดตแบบตาราง': 'table', 'สวนรอยืนยัน': 'pending', 'รหัสเชิญ': 'invite', 'ส่งรูป': 'photohint',
  'วิธีใช้': 'help', 'เมนู': 'help'
};
const MENU_CMDS = ['mine', 'bloom', 'sell', 'table', 'photohint', 'image'];
const REASONS = {
  need_info: ['รูปไม่มีตำแหน่ง ขอถ่ายใหม่ที่สวน', 'ชื่อไม่ตรงทะเบียนเกษตรกร', 'หมุดไม่ตรงสวน'],
  rejected: ['สวนอยู่นอกพื้นที่', 'ลงทะเบียนซ้ำ', 'ไม่ใช่สวนทุเรียน']
};
const MENU_QR = [['สวนของฉัน', pb({ a: 'mine' })], ['ดอกบาน', pb({ a: 'bloom' })], ['ขาย/จองแล้ว', pb({ a: 'sell' })], ['อัปเดตแบบตาราง', pb({ a: 'table' })]];
const PHOTO_TTL = 900; // รูปที่ส่งมารอจัดพันธุ์ เก็บไว้ 15 นาที

export async function handleFarmer(env, ev) {
  const userId = ev.source && ev.source.userId;
  if (!userId || !ev.replyToken) return;
  const token = env.LINE_FARMER_TOKEN;
  const send = (...msgs) => reply(token, ev.replyToken, msgs.flat());

  let cmd = null, p = {};
  if (ev.type === 'postback') { p = parsePb(ev.postback.data); cmd = p.a; }
  else if (ev.type === 'message' && ev.message.type === 'text') cmd = CMDS[ev.message.text.trim()] || 'text';
  else if (ev.type === 'message' && ev.message.type === 'image') cmd = 'image';
  else if (ev.type === 'follow') cmd = 'follow';
  else return;

  // อัปโหลดรูปก่อน (ไม่ต้องรอข้อมูลสวน) — ถ้าเป็นรูปในชุดที่ยังไม่ใช่รูปสุดท้าย ไม่ต้องตอบ
  if (cmd === 'image') {
    try {
      const { buf, type } = await getContent(token, ev.message.id);
      const ph = await upload(env, buf, type);
      await env.DATA.put(`ph:${userId}:${ev.message.id}`, JSON.stringify(ph), { expirationTtl: PHOTO_TTL });
    } catch (e) {
      console.error(e);
      return send(text('อัปโหลดรูปไม่สำเร็จ ลองส่งใหม่อีกครั้งครับ'));
    }
    const set = ev.message.imageSet;
    if (set && set.total && set.index < set.total) return;
  }

  const ctx = await gas(env, 'context', { userId });
  const out = [];
  if (ctx.statusNote) out.push(text(statusText(ctx.statusNote)));

  /* ----- ยังไม่ผูกกับสวน ----- */
  if (!ctx.user && !ctx.isOfficer) {
    if (ev.type === 'message' && ev.message.type === 'text' && /^\d{6}$/.test(ev.message.text.trim())) {
      try {
        const prof = await profile(token, userId);
        const r = await gas(env, 'redeem', { userId, code: ev.message.text.trim(), displayName: prof.displayName });
        return send(text(`ผูกบัญชีกับ ${r.farm_name} แล้วครับ ช่วยอัปเดตสวนผ่านเมนูด้านล่างได้เลย`, MENU_QR));
      } catch (e) {
        return send(text(e.message));
      }
    }
    const prof = await profile(token, userId);
    await gas(env, 'seen', { userId, channel: 'farmer', displayName: prof.displayName }).catch(() => {});
    return send(text(
      `สวัสดีครับ บัญชีนี้ยังไม่ได้ลงทะเบียนสวน\n\nลงทะเบียนสวนใหม่: https://liff.line.me/${env.LIFF_REGISTER_ID}\n\nถ้าครอบครัวลงทะเบียนไว้แล้ว ให้พิมพ์รหัสเชิญ 6 หลักที่ได้จากเจ้าของสวน`
    ));
  }

  /* ----- เจ้าหน้าที่ ----- */
  if (ctx.isOfficer && (cmd === 'pending' || (cmd && cmd.startsWith('of')))) return send(out, await officer(env, userId, cmd, p));
  if (ctx.isOfficer && !ctx.user) return send(out, text('เมนูเจ้าหน้าที่', [['สวนรอยืนยัน', pb({ a: 'pending' })]]));

  /* ----- เกษตรกร ----- */
  const f = new Farmer(env, userId, ctx);
  if (ctx.pendingLeads && MENU_CMDS.includes(cmd) && cmd !== 'image') {
    out.push(text(`มีลูกค้าติดต่อไป ${ctx.pendingLeads} ราย ขายหรือจองไปแล้วหรือยังครับ`,
      [['ขายไปแล้ว', pb({ a: 'lr', o: 'sold' })], ['ยังไม่ได้ขาย', pb({ a: 'lr', o: 'not' })]]));
    return send(out);
  }
  const msgs = await f.handle(cmd, p);
  await send(out, msgs);
  // ข้อมูลเปลี่ยน -> อัปเดตสำเนาให้ลูกค้าเห็นทันที (เขียน KV เฉพาะเมื่อข้อมูลต่างจากเดิม)
  if (MUTATING.includes(cmd)) await refreshSnap(env).catch((e) => console.error('refresh', e));
}

const MUTATING = ['sd', 'sc', 'fc', 'st', 'pm', 'pl', 'bn', 'bnp', 'pv'];

function statusText(n) {
  if (n.status === 'verified') return 'สวนของคุณได้รับการยืนยันจากเจ้าหน้าที่แล้ว ลูกค้าค้นหาเจอแล้วครับ';
  if (n.status === 'need_info') return `เจ้าหน้าที่ขอข้อมูลเพิ่ม: ${n.reason || '-'}\nแก้ไขแล้วแจ้งเจ้าหน้าที่ประจำตำบลได้เลยครับ`;
  if (n.status === 'rejected') return `ยังยืนยันสวนไม่ได้: ${n.reason || '-'}\nสอบถามสำนักงานเกษตรอำเภอได้ครับ`;
  return '';
}

async function officer(env, userId, cmd, p) {
  if (cmd === 'pending') {
    const farms = await gas(env, 'pending', { userId });
    return farms.length ? [text(`มีสวนรอยืนยัน ${farms.length} สวน`), officerCards(farms)] : [text('ไม่มีสวนรอยืนยันครับ')];
  }
  if (cmd === 'ofr') {
    return [text('เลือกเหตุผลครับ', REASONS[p.d].map((r, i) => [r, pb({ a: 'ofv', f: p.f, d: p.d, r: i })]))];
  }
  if (cmd === 'ofv') {
    const reason = p.r !== undefined ? REASONS[p.d][Number(p.r)] : '';
    await gas(env, 'verify', { userId, farmId: p.f, decision: p.d, reason });
    if (p.d === 'verified') await refreshSnap(env).catch((e) => console.error(e));
    const label = { verified: 'ยืนยันแล้ว สวนขึ้นให้ลูกค้าค้นหาได้', need_info: 'ส่งคำขอข้อมูลเพิ่มแล้ว', rejected: 'บันทึกว่าไม่ผ่านแล้ว' }[p.d];
    return [text(`${p.f}: ${label}${reason ? ' (' + reason + ')' : ''}\nเกษตรกรจะเห็นผลตอนทักบอทครั้งถัดไป`, [['สวนรอยืนยัน', pb({ a: 'pending' })]])];
  }
  return [text('ไม่เข้าใจคำสั่งครับ', [['สวนรอยืนยัน', pb({ a: 'pending' })]])];
}

class Farmer {
  constructor(env, userId, ctx) {
    this.env = env; this.userId = userId; this.ctx = ctx; this.farmId = ctx.user.farm_id;
  }
  lot(id) { return this.ctx.lots.find((l) => l.lot_id === id); }
  ofV(v) { return this.ctx.lots.filter((l) => l.variety === v); }
  multi(l) { return l.wave > 1 || this.ofV(l.variety).some((x) => x !== l && x.stage > 0 && x.stage < 4); }
  name(l) { return this.multi(l) ? `${l.variety} รุ่น ${l.wave}` : l.variety; }
  varieties() { return [...new Set([...this.ctx.varieties.map((v) => v.variety), ...this.ctx.lots.map((l) => l.variety)])]; }
  topV() {
    const rec = (v) => Math.max(0, ...this.ofV(v).map((l) => new Date(l.updated_at).getTime() || 0));
    return this.varieties().sort((a, b) => (this.ofV(b).some(has) - this.ofV(a).some(has)) || (rec(b) - rec(a))).slice(0, 4);
  }
  /** ปุ่มเลือกพันธุ์: 4 พันธุ์ที่ใช้บ่อย + พันธุ์อื่น */
  pickV(a, question, extra = []) {
    const top = this.topV();
    const more = this.varieties().length > top.length ? [['พันธุ์อื่น ›', pb({ a: 'more', k: a })]] : [];
    return text(question, [...top.map((v) => [v, pb({ a, v })]), ...more, ...extra]);
  }
  async takePhotos() {
    const list = await this.env.DATA.list({ prefix: `ph:${this.userId}:` });
    const out = [];
    for (const k of list.keys) {
      const v = await this.env.DATA.get(k.name, 'json');
      if (v) out.push(v);
      await this.env.DATA.delete(k.name);
    }
    return out;
  }
  done(l, pic) {
    const info = l.stage === 3 ? ` คงเหลือ ${l.remaining} ลูก` : l.stage === 2 ? ` ~${l.remaining} ลูก` : l.stage === 1 && l.harvest_from ? ` คาดตัด ${period(l.harvest_from)}` : '';
    return text(`บันทึกแล้ว ${this.name(l)} · ${STAGES[l.stage]}${info}${pic ? ' รูปจะขึ้นไทม์ไลน์บนเว็บ' : ''} ครับ`, MENU_QR);
  }
  replaceLot(l) {
    const i = this.ctx.lots.findIndex((x) => x.lot_id === l.lot_id);
    if (l.status === 'closed') { if (i >= 0) this.ctx.lots.splice(i, 1); }
    else if (i >= 0) this.ctx.lots[i] = l; else this.ctx.lots.push(l);
    return l;
  }
  async stage(lotId, stage, remaining, photos) {
    const l = await gas(this.env, 'stage', { userId: this.userId, lotId, stage, remaining, photos });
    return this.replaceLot(l);
  }
  countQR(l, s, photo) {
    return text(`${this.name(l)} ไว้ผลประมาณกี่ลูกครับ`, [
      ...[10, 20, 50, 100, 200].map((n) => [`~${n} ลูก`, pb({ a: 'fc', l: l.lot_id, s, n, p: photo ? 1 : 0 })]),
      ['เหมือนเดิม', pb({ a: 'fc', l: l.lot_id, s, n: -1, p: photo ? 1 : 0 })]
    ]);
  }

  async handle(cmd, p) {
    const env = this.env, uid = this.userId;
    switch (cmd) {
      case 'mine':
        return [mineCards(this.ctx, (l) => this.name(l), (l) => this.multi(l))];

      case 'photohint':
        return [text('ถ่ายรูปแล้วส่งในแชตนี้ได้เลยครับ ส่งหลายรูปพร้อมกันได้ (ควรเป็นพันธุ์เดียวกันในชุดเดียว)')];

      case 'image':
        return [this.pickV('pv', 'รูปชุดนี้พันธุ์อะไรครับ', [['บรรยากาศสวน', pb({ a: 'pv', v: '_farm' })]])];

      case 'more': {
        const top = this.topV();
        const rest = this.varieties().filter((v) => !top.includes(v));
        const extra = p.k === 'pv' ? [['บรรยากาศสวน', pb({ a: 'pv', v: '_farm' })]] : [];
        return [text('เลือกพันธุ์ครับ', [...rest.map((v) => [v, pb({ a: p.k, v })]), ...extra])];
      }

      case 'pv': { // เลือกพันธุ์ของรูป
        if (p.v === '_farm') {
          const photos = await this.takePhotos();
          if (!photos.length) return [text('ไม่พบรูปที่ส่งมา ลองส่งรูปใหม่อีกครั้งครับ')];
          await gas(env, 'photo', { userId: uid, farmId: this.farmId, lotId: '', photos });
          return [text('บันทึกเป็นรูปบรรยากาศสวนแล้วครับ', MENU_QR)];
        }
        return [text(`${p.v} ในรูปอยู่ระยะไหนครับ`, [[STAGES[1], 1], [STAGES[2], 2], ['ใกล้ตัด/พร้อมตัด', 3]]
          .map(([lb, s]) => [lb, pb({ a: 'ps', v: p.v, s })]))];
      }

      case 'ps': { // ระยะของรูป -> หารุ่นให้อัตโนมัติ
        const s = Number(p.s), v = p.v;
        const same = this.ofV(v).filter((l) => l.stage === s);
        if (same.length === 1) return this.handle('pl', { l: same[0].lot_id });
        if (same.length > 1) return [text(`${v} มี ${same.length} รุ่นที่อยู่ระยะ${STAGES[s]} รูปนี้รุ่นไหนครับ`,
          same.map((l) => [`รุ่น ${l.wave} · บาน ${thaiShort(l.bloom_date)}`, pb({ a: 'pl', l: l.lot_id })]))];
        if (s === 1) return [text(`ยังไม่มี${v}รุ่นที่ดอกบาน เริ่มรุ่นใหม่ (ดอกบานวันนี้) ใช่ไหมครับ`,
          [['ใช่ เริ่มรุ่นใหม่', pb({ a: 'bnp', v })], ['ไม่ใช่', pb({ a: 'x' })]])];
        const lower = this.ofV(v).filter((l) => l.stage > 0 && l.stage < s);
        if (lower.length === 1) return [text(`${this.name(lower[0])} เลื่อนเป็นระยะ${STAGES[s]}แล้วใช่ไหมครับ`,
          [['ใช่', pb({ a: 'pm', l: lower[0].lot_id, s })], ['ไม่ใช่', pb({ a: 'x' })]])];
        if (lower.length > 1) return [text(`ยังไม่มีรุ่นที่อยู่ระยะ${STAGES[s]} รุ่นไหนเลื่อนมาถึงระยะนี้ครับ`,
          lower.map((l) => [`รุ่น ${l.wave} · ${STAGES[l.stage]}`, pb({ a: 'pm', l: l.lot_id, s })]))];
        return [text(`ยังไม่มี${v}รุ่นที่ออกดอก กดเมนู "ดอกบาน" เพื่อเริ่มรุ่นใหม่ก่อนครับ`, MENU_QR)];
      }

      case 'pl': { // แนบรูปเข้ารุ่น
        const l = this.lot(p.l);
        const photos = await this.takePhotos();
        if (!photos.length) return [text('ไม่พบรูปที่ส่งมา ลองส่งรูปใหม่อีกครั้งครับ')];
        const r = await gas(env, 'photo', { userId: uid, farmId: this.farmId, lotId: p.l, photos });
        return [text(`บันทึกรูป ${photos.length} รูปเป็น ${this.name(l || r)} แล้วครับ รูปจะขึ้นไทม์ไลน์บนเว็บ`, MENU_QR)];
      }

      case 'pm': { // ยืนยันเลื่อนระยะจากรูป
        const l = this.lot(p.l), s = Number(p.s);
        if (s >= 2) return [this.countQR(l, s, true)];
        const photos = await this.takePhotos();
        return [this.done(await this.stage(p.l, s, undefined, photos), photos.length)];
      }

      case 'fc': { // จำนวนผล
        const photos = p.p === '1' ? await this.takePhotos() : [];
        const n = Number(p.n);
        return [this.done(await this.stage(p.l, Number(p.s), n >= 0 ? n : undefined, photos), photos.length)];
      }

      case 'bloom':
        return [this.pickV('bv', 'ดอกพันธุ์ไหนบานครับ')];

      case 'bv': {
        const act = this.ofV(p.v).filter((l) => l.stage >= 1 && l.stage < 4);
        if (act.length) return [text(`${p.v} มีดอกหรือผลอยู่แล้ว ${act.length} รุ่น (${act.map((l) => STAGES[l.stage]).join(', ')}) ดอกที่บานนี้เป็นรุ่นใหม่ใช่ไหมครับ`,
          [['ใช่ รุ่นใหม่', pb({ a: 'bn', v: p.v })], ['ไม่ใช่', pb({ a: 'x' })]])];
        return this.handle('bn', p);
      }

      case 'bn':
      case 'bnp': {
        const l = this.replaceLot(await gas(env, 'wave', { userId: uid, farmId: this.farmId, variety: p.v }));
        const msg = text(`เริ่ม ${this.name(l)} แล้วครับ ดอกบาน ${thaiShort(l.bloom_date)} คาดว่าตัดได้ช่วง ${period(l.harvest_from)} – ${period(l.harvest_to)}`, MENU_QR);
        if (cmd === 'bnp') {
          const photos = await this.takePhotos();
          if (photos.length) await gas(env, 'photo', { userId: uid, farmId: this.farmId, lotId: l.lot_id, photos });
        }
        return [msg];
      }

      case 'lot': {
        const l = this.lot(p.l);
        if (!l) return [text('ไม่พบรุ่นนี้ อาจปิดไปแล้วครับ', MENU_QR)];
        const items = [['อัปเดตระยะ', pb({ a: 'ls', l: l.lot_id })]];
        if (has(l)) items.push(['ขาย/จองแล้ว', pb({ a: 'sq', l: l.lot_id })]);
        items.push(['ปิดรุ่นนี้', pb({ a: 'sc', l: l.lot_id })]);
        const info = l.bloom_date ? ` · บาน ${thaiShort(l.bloom_date)}` : '';
        return [text(`${this.name(l)} · ${STAGES[l.stage]}${info}${has(l) ? ` · เหลือ ~${l.remaining} ลูก` : ''}\nต้องการทำอะไรครับ (ส่งรูปของรุ่นนี้: ส่งรูปในแชตได้เลย)`, items)];
      }

      case 'ls': {
        const l = this.lot(p.l);
        return [text(`${this.name(l)} ตอนนี้ระยะไหนครับ`, [1, 2, 3].map((s) => [STAGES[s], pb({ a: 'st', l: l.lot_id, s })]))];
      }

      case 'st': {
        const l = this.lot(p.l), s = Number(p.s);
        if (s >= 2) return [this.countQR(l, s, false)];
        return [this.done(await this.stage(p.l, s))];
      }

      case 'sell': {
        const ok = this.ctx.lots.filter(has);
        if (!ok.length) return [text('ตอนนี้ยังไม่มีรุ่นที่เปิดขายหรือจองครับ', MENU_QR)];
        if (ok.length === 1) return this.handle('sq', { l: ok[0].lot_id });
        return [text(`มี ${ok.length} รายการที่เปิดขายหรือจอง รายการไหนครับ`,
          ok.map((l) => [cut(`${this.name(l)} · ${STAGES[l.stage]}`, 20), pb({ a: 'sq', l: l.lot_id })]))];
      }

      case 'sq': {
        const l = this.lot(p.l);
        return [text(`${this.name(l)} ขายหรือจองไปกี่ลูกครับ (คงเหลือ ${l.remaining})`, [
          ...[1, 2, 5, 10, 20].map((n) => [String(n), pb({ a: 'sd', l: l.lot_id, n })]),
          ['ปิดรับรุ่นนี้', pb({ a: 'sc', l: l.lot_id })]
        ])];
      }

      case 'sd':
      case 'sc': {
        const before = this.lot(p.l);
        const name = before ? this.name(before) : '';
        const l = this.replaceLot(await gas(env, 'sell', { userId: uid, lotId: p.l, qty: cmd === 'sd' ? Number(p.n) : 0, close: cmd === 'sc' }));
        return [text(l.status === 'closed' ? `${name} ปิดรุ่นแล้วครับ` : `${name} คงเหลือ ${l.remaining} ลูกครับ`, MENU_QR)];
      }

      case 'lr':
        if (p.o === 'sold') return this.handle('sell', {});
        await gas(env, 'leadsResolve', { userId: uid, outcome: 'not_sold' });
        return [text('รับทราบครับ', MENU_QR)];

      case 'table':
        return [text(`เปิดหน้าอัปเดตแบบตาราง (เหมาะให้ลูกหลานช่วยอัปเดตหลายพันธุ์พร้อมกัน):\nhttps://liff.line.me/${env.LIFF_TABLE_ID}`)];

      case 'invite': {
        if (this.ctx.user.role !== 'farmer') return [text('เฉพาะเจ้าของสวนที่ขอรหัสเชิญได้ครับ')];
        const r = await gas(env, 'invite', { userId: uid });
        return [text(`รหัสเชิญ: ${r.code}\nให้ลูกหลานเพิ่มเพื่อน LINE OA นี้ แล้วพิมพ์รหัส (ใช้ได้ 24 ชั่วโมง)`)];
      }

      case 'x':
        return [text('รับทราบครับ', MENU_QR)];

      case 'follow':
      case 'help':
      case 'text':
      default:
        return [text('เมนูของเกษตรกร:\n• สวนของฉัน — ดูทุกพันธุ์ทุกรุ่น\n• ส่งรูป — ถ่ายแล้วส่งในแชตได้เลย\n• ดอกบาน — เริ่มรุ่นใหม่\n• ขาย/จองแล้ว — ตัดสต็อก\n• รหัสเชิญ — ให้ลูกหลานช่วยดูแล', MENU_QR)];
    }
  }
}

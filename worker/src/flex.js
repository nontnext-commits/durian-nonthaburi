import { STAGES, pb, has, statText, ago, thaiShort, cut, daysAgo } from './util.js';

const GREEN = '#06C755';
const MUTE = '#8a8a8a';
const WARN = '#b26a00';

const t = (text, o = {}) => ({ type: 'text', text: String(text === '' || text === null || text === undefined ? '-' : text), wrap: true, size: 'sm', ...o });
const box = (contents, o = {}) => ({ type: 'box', layout: 'vertical', contents, ...o });
const hbox = (contents, o = {}) => ({ type: 'box', layout: 'horizontal', contents, ...o });
const postBtn = (label, data, style = 'secondary') =>
  ({ type: 'button', style, height: 'sm', ...(style === 'primary' ? { color: GREEN } : {}), action: { type: 'postback', label: cut(label, 20), data, displayText: cut(label, 300) } });
const uriBtn = (label, uri, style = 'link') => ({ type: 'button', style, height: 'sm', action: { type: 'uri', label: cut(label, 20), uri } });

export const flex = (altText, contents) => ({ type: 'flex', altText: cut(altText, 400), contents });
export const carousel = (altText, bubbles) => flex(altText, { type: 'carousel', contents: bubbles.slice(0, 12) });

/* ---------------- ลูกค้า ---------------- */

/** การ์ดสวน 1 ใบต่อสวนต่อพันธุ์ */
export function farmCard(env, farm, variety, p, nx) {
  const photo = (p && p.last_photo_url) || farm.cover_photo_url;
  const rows = [
    t(farm.farm_name, { weight: 'bold', size: 'md' }),
    t(`${farm.tambon || ''}${farm.accepts_booking ? ' · รับจอง' : ''}${farm.pickup ? ' · ' + farm.pickup : ''}`, { color: MUTE, size: 'xs' }),
    t(`${variety} · ${statText(p)}`, { margin: 'md' })
  ];
  if (nx) rows.push(t(`รุ่นถัดไป: ${statText(nx)}`, { color: MUTE, size: 'xs' }));
  rows.push(t(`อัปเดต ${ago(p && p.updated_at)} · ราคาสอบถามสวน`, { color: daysAgo(p && p.updated_at) > 7 ? WARN : MUTE, size: 'xs', margin: 'sm' }));
  if (daysAgo(p && p.updated_at) > 7) rows.push(t('ข้อมูลอาจไม่เป็นปัจจุบัน กรุณาสอบถามสวน', { color: WARN, size: 'xs' }));
  const footer = [];
  const lotId = (p && p.lot_id) || '';
  if (p && has(p)) footer.push(postBtn('ติดต่อสวน', pb({ a: 'lead', f: farm.farm_id, v: variety, l: lotId }), 'primary'));
  footer.push(postBtn('ติดตามสวน', pb({ a: 'fol', f: farm.farm_id, v: variety })));
  if (env.WEB_URL) footer.push(uriBtn('ดูเรื่องเล่าและรูป', `${env.WEB_URL}#farm-${farm.farm_id}`));
  const bubble = { type: 'bubble', size: 'kilo', body: box(rows, { spacing: 'xs' }), footer: box(footer, { spacing: 'sm' }) };
  if (photo) bubble.hero = { type: 'image', url: photo, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' };
  return bubble;
}

/** หลังลูกค้ากดติดต่อสวน: แสดงช่องทางที่สวนยินยอมให้แสดง */
export function contactCard(farm) {
  const btns = [];
  if (farm.phone) btns.push(uriBtn(`โทร ${farm.phone}`, `tel:${String(farm.phone).replace(/[^\d+]/g, '')}`, 'primary'));
  if (farm.line_oa_id) btns.push(uriBtn('แชต LINE ของสวน', `https://line.me/R/ti/p/${encodeURIComponent(farm.line_oa_id.startsWith('@') ? farm.line_oa_id : '@' + farm.line_oa_id)}`));
  if (farm.facebook_url && /^https:\/\//.test(farm.facebook_url)) btns.push(uriBtn('เพจ Facebook', farm.facebook_url));
  const body = [
    t(farm.farm_name, { weight: 'bold', size: 'md' }),
    t('ตกลงราคา การจอง และการรับสินค้ากับสวนได้โดยตรงครับ', { color: MUTE, size: 'xs' })
  ];
  if (farm.phone) body.push(t(`โทร ${farm.phone}`, { margin: 'md' }));
  if (!btns.length) body.push(t('สวนนี้ยังไม่ได้เปิดช่องทางติดต่อ กรุณาติดต่อสำนักงานเกษตรอำเภอ', { margin: 'md' }));
  return flex(`ช่องทางติดต่อ ${farm.farm_name}`, { type: 'bubble', size: 'kilo', body: box(body, { spacing: 'xs' }), footer: btns.length ? box(btns, { spacing: 'sm' }) : undefined });
}

/* ---------------- เกษตรกร ---------------- */

/** การ์ด "สวนของฉัน": แยก กำลังมีผลผลิต / ยังไม่ถึงระยะขาย, พันธุ์ที่มีหลายรุ่นแสดงเป็นกลุ่ม */
export function mineCards(ctx, lname, multi) {
  const lots = ctx.lots;
  const vnames = [...new Set([...ctx.varieties.map((v) => v.variety), ...lots.map((l) => l.variety)])];
  const ofV = (v) => lots.filter((l) => l.variety === v).sort((a, b) => a.wave - b.wave);
  const trees = (v) => (ctx.varieties.find((x) => x.variety === v) || {}).trees || 0;
  const recent = (v) => Math.max(0, ...ofV(v).map((l) => new Date(l.updated_at).getTime() || 0));
  const info = (l) => (l.stage === 3 && l.remaining ? `เหลือ ${l.remaining}` : l.stage === 2 ? `~${l.remaining} ลูก` : l.stage === 1 && l.harvest_from ? `ตัด ${thaiShort(l.harvest_from)}` : '');
  const row = (label, l, indent) => hbox([
    t(label, { flex: 4, size: 'sm', ...(indent ? { offsetStart: '12px' } : {}) }),
    t(STAGES[l.stage], { flex: 3, size: 'xs', color: MUTE }),
    t(info(l) || (daysAgo(l.updated_at) > 7 ? ago(l.updated_at) : '·'), { flex: 3, size: 'xs', color: daysAgo(l.updated_at) > 7 ? WARN : MUTE, align: 'end' }),
    t('›', { flex: 1, align: 'end', color: GREEN, weight: 'bold' })
  ], { paddingTop: '6px', paddingBottom: '6px', action: { type: 'postback', label: cut(lname(l), 20), data: pb({ a: 'lot', l: l.lot_id }), displayText: lname(l) } });
  const block = (v) => {
    const ls = ofV(v);
    if (!ls.length) return [hbox([t(v, { flex: 4 }), t('ไม่มีรุ่นที่เปิดอยู่', { flex: 6, size: 'xs', color: MUTE })], { paddingTop: '6px', paddingBottom: '6px' })];
    if (ls.length === 1 && !multi(ls[0])) return [row(v, ls[0])];
    return [t(`${v} (${trees(v)} ต้น · ${ls.length} รุ่น)`, { weight: 'bold', margin: 'md' }), ...ls.map((l) => row(`รุ่น ${l.wave}`, l, true))];
  };
  const selling = vnames.filter((v) => ofV(v).some(has)).sort((a, b) => recent(b) - recent(a));
  const rest = vnames.filter((v) => !selling.includes(v));
  const bubble = (title, vs, note) => ({
    type: 'bubble', size: 'mega',
    body: box([
      t(title, { weight: 'bold', color: MUTE }),
      ...(note ? [t(note, { size: 'xs', color: WARN })] : []),
      { type: 'separator', margin: 'sm' },
      ...(vs.length ? vs.flatMap(block) : [t('ไม่มี', { color: MUTE, margin: 'md' })])
    ], { spacing: 'none' })
  });
  const pendingNote = ctx.farm && ctx.farm.status !== 'verified' ? 'สวนยังรอเจ้าหน้าที่ยืนยัน ลูกค้ายังไม่เห็นสวนนี้' : '';
  return carousel('สวนของฉัน', [
    bubble(`กำลังมีผลผลิต (${selling.length} พันธุ์)`, selling, pendingNote),
    bubble(`ยังไม่ถึงระยะขาย (${rest.length} พันธุ์)`, rest)
  ]);
}

/* ---------------- เจ้าหน้าที่ ---------------- */

const ICON = { ok: '✓', wa: '!', no: '✕' };
const ICOL = { ok: '#2f7d16', wa: WARN, no: '#b02a2a' };

export function officerCards(farms) {
  return carousel(`สวนรอยืนยัน ${farms.length} สวน`, farms.slice(0, 10).map((f) => {
    const checks = (f.auto_checks || []).map(([lv, msg]) => hbox([t(ICON[lv] || '-', { flex: 0, color: ICOL[lv], weight: 'bold' }), t(msg, { size: 'xs', offsetStart: '6px' })]));
    const footer = [
      postBtn('ยืนยัน', pb({ a: 'ofv', f: f.farm_id, d: 'verified' }), 'primary'),
      postBtn('ขอข้อมูลเพิ่ม', pb({ a: 'ofr', f: f.farm_id, d: 'need_info' })),
      postBtn('ไม่ผ่าน', pb({ a: 'ofr', f: f.farm_id, d: 'rejected' }))
    ];
    if (f.phone) footer.push(uriBtn(`โทร ${f.phone}`, `tel:${String(f.phone).replace(/[^\d+]/g, '')}`));
    if (f.lat && f.lng) footer.push(uriBtn('ดูหมุดบนแผนที่', `https://www.google.com/maps/search/?api=1&query=${f.lat},${f.lng}`));
    return {
      type: 'bubble', size: 'kilo',
      body: box([
        t(f.farm_name, { weight: 'bold', size: 'md' }),
        t(`${f.owner_name} · ${f.tambon}`, { size: 'xs', color: MUTE }),
        t(`ลงทะเบียน ${thaiShort(f.registered_at)}${f.status === 'need_info' ? ' · รอข้อมูลเพิ่ม' : ''}`, { size: 'xs', color: MUTE }),
        t((f.varieties || []).map((v) => `${v.variety} ${v.trees} ต้น`).join(', '), { size: 'xs', margin: 'md' }),
        { type: 'separator', margin: 'md' },
        ...checks,
        t('ตรวจชื่อกับทะเบียนเกษตรกรก่อนกดยืนยัน', { size: 'xxs', color: MUTE, margin: 'md' })
      ], { spacing: 'xs' }),
      footer: box(footer, { spacing: 'sm' })
    };
  }));
}

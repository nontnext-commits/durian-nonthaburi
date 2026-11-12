/**
 * Cloudflare Worker — ทุเรียนนนท์
 *   POST /webhook/farmer     LINE OA เกษตรกร (และเจ้าหน้าที่)
 *   POST /webhook/customer   LINE OA ลูกค้า
 *   GET  /api/public         ข้อมูลสาธารณะสำหรับเว็บ Storytelling
 *   GET  /api/varieties      รายชื่อพันธุ์สำหรับหน้าลงทะเบียน
 *   POST /api/register       ลงทะเบียนสวนจาก LIFF
 *   POST /api/myfarm         ข้อมูลสวนของผู้ใช้ (หน้าตาราง LIFF)
 *   POST /api/table          บันทึกจากหน้าตาราง LIFF
 *   cron ทุก 5 นาที           ดึงข้อมูลจาก Google Sheets มาเก็บใน KV
 */
import { verifySignature, verifyIdToken } from './line.js';
import { gas, getSnap, refreshSnap } from './gas.js';
import { handleFarmer } from './farmer.js';
import { handleCustomer } from './customer.js';
import { json } from './util.js';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = {
      'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      if (req.method === 'POST' && url.pathname === '/webhook/farmer') return webhook(req, env, ctx, env.LINE_FARMER_SECRET, handleFarmer);
      if (req.method === 'POST' && url.pathname === '/webhook/customer') return webhook(req, env, ctx, env.LINE_CUSTOMER_SECRET, handleCustomer);

      if (req.method === 'GET' && url.pathname === '/api/public') {
        return json(await getSnap(env), 200, { ...cors, 'cache-control': 'public, max-age=60' });
      }
      if (req.method === 'GET' && url.pathname === '/api/varieties') {
        const s = await getSnap(env);
        return json(s.varieties || [], 200, cors);
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        const body = await req.json().catch(() => ({}));
        const who = await verifyIdToken(body.idToken, env.LINE_LOGIN_CHANNEL_ID);
        const userId = who.sub;
        if (url.pathname === '/api/register') {
          return json(await gas(env, 'register', { userId, displayName: who.name, form: body.form }), 200, cors);
        }
        if (url.pathname === '/api/myfarm') return json(await gas(env, 'context', { userId }), 200, cors);
        if (url.pathname === '/api/table') {
          const r = await gas(env, 'table', { userId, items: body.items || [] });
          ctx.waitUntil(refreshSnap(env).catch((e) => console.error(e)));
          return json(r, 200, cors);
        }
      }
      if (url.pathname === '/') return new Response('durian-nonthaburi worker ok');
      return new Response('not found', { status: 404, headers: cors });
    } catch (e) {
      console.error(e);
      return json({ error: String(e.message || e) }, 400, cors);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshSnap(env).catch((e) => console.error('snapshot', e)));
  }
};

/** ตรวจลายเซ็น แล้วตอบ LINE ทันที (200) ส่วนการทำงานจริงทำเบื้องหลัง */
async function webhook(req, env, ctx, secret, handler) {
  const body = await req.text();
  const ok = await verifySignature(body, req.headers.get('x-line-signature'), secret);
  if (!ok) return new Response('bad signature', { status: 401 });
  const events = (JSON.parse(body).events || []);
  ctx.waitUntil(Promise.all(events.map((ev) => handler(env, ev).catch((e) => console.error('event', e)))));
  return new Response('ok');
}

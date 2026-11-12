/** เรียก Apps Script API (ฐานข้อมูล Google Sheets) */
export async function gas(env, action, params = {}) {
  const r = await fetch(env.GAS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: env.GAS_SECRET, action, ...params }),
    redirect: 'follow'
  });
  const txt = await r.text();
  let res;
  try {
    res = JSON.parse(txt);
  } catch (e) {
    throw new Error(`GAS ${action}: ตอบกลับไม่ใช่ JSON (${r.status})`);
  }
  if (!res.ok) throw new Error(res.error || 'gas_error');
  return res.data;
}

/** ข้อมูลสาธารณะที่ cache ไว้ใน KV (ดึงใหม่ทุก 5 นาทีโดย cron) */
export async function getSnap(env) {
  const s = await env.DATA.get('snapshot', 'json');
  return s || refreshSnap(env);
}

/** เขียน KV เฉพาะเมื่อข้อมูลเปลี่ยน (แพ็กเกจฟรีจำกัดจำนวนครั้งที่เขียนต่อวัน) */
export async function refreshSnap(env) {
  const s = await gas(env, 'snapshot');
  const sig = (o) => JSON.stringify({ ...o, generated_at: '' });
  const old = await env.DATA.get('snapshot', 'json');
  if (!old || sig(old) !== sig(s)) await env.DATA.put('snapshot', JSON.stringify(s));
  return s;
}

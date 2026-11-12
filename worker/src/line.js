const API = 'https://api.line.me';

/** ตรวจลายเซ็น X-Line-Signature (HMAC-SHA256 ของ body ด้วย channel secret) */
export async function verifySignature(body, signature, secret) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

async function call(token, path, body) {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) console.error('LINE', path, r.status, await r.text());
  return r.ok;
}

/** ตอบกลับ (ฟรี ไม่นับโควตา) — สูงสุด 5 ข้อความต่อครั้ง */
export const reply = (token, replyToken, messages) =>
  call(token, '/v2/bot/message/reply', { replyToken, messages: messages.filter(Boolean).slice(0, 5) });

/** แสดง "กำลังพิมพ์..." ในแชต 1:1 */
export const loading = (token, chatId, loadingSeconds = 20) =>
  call(token, '/v2/bot/chat/loading/start', { chatId, loadingSeconds });

export async function getContent(token, messageId) {
  const r = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error('content ' + r.status);
  return { buf: await r.arrayBuffer(), type: r.headers.get('content-type') || 'image/jpeg' };
}

export async function profile(token, userId) {
  try {
    const r = await fetch(`${API}/v2/bot/profile/${userId}`, { headers: { authorization: `Bearer ${token}` } });
    return r.ok ? await r.json() : {};
  } catch (e) {
    return {};
  }
}

/** ตรวจ ID token จาก LIFF — คืน { sub: userId, name } */
export async function verifyIdToken(idToken, channelId) {
  const r = await fetch(`${API}/oauth2/v2.1/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken || '', client_id: channelId || '' })
  });
  if (!r.ok) throw new Error('invalid_id_token');
  return r.json();
}

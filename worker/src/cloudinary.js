/** อัปโหลดรูปเข้า Cloudinary (signed upload) แล้วคืนลิงก์ที่ย่อขนาดและไม่มีข้อมูล EXIF */

async function sha1hex(s) {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** แปลงค่า GPS แบบ "13 deg 51' 3.12\" N" หรือ "13.85" เป็นทศนิยม */
export function parseGps(v, ref) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  const nums = s.match(/-?\d+(\.\d+)?/g);
  if (!nums) return null;
  let x = nums.length >= 3 ? +nums[0] + +nums[1] / 60 + +nums[2] / 3600 : +nums[0];
  const r = (ref || s).toUpperCase();
  if (/\b[SW]\b|[SW]$/.test(r.trim())) x = -Math.abs(x);
  return Math.round(x * 1e6) / 1e6;
}

export function publicUrl(env, publicId, w = 1280) {
  return `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD}/image/upload/f_jpg,q_auto,w_${w},c_limit/${publicId}.jpg`;
}

export async function upload(env, buf, type, folder = 'durian') {
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `folder=${folder}&image_metadata=true&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`;
  const form = new FormData();
  form.append('file', new Blob([buf], { type }));
  form.append('api_key', env.CLOUDINARY_API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('image_metadata', 'true');
  form.append('signature', await sha1hex(toSign));
  const r = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD}/image/upload`, { method: 'POST', body: form });
  if (!r.ok) throw new Error('cloudinary ' + r.status + ' ' + (await r.text()));
  const j = await r.json();
  const m = j.image_metadata || {};
  return {
    url: publicUrl(env, j.public_id),
    public_id: j.public_id,
    lat: parseGps(m.GPSLatitude, m.GPSLatitudeRef),
    lng: parseGps(m.GPSLongitude, m.GPSLongitudeRef),
    taken: m.DateTimeOriginal || m.CreateDate || ''
  };
}

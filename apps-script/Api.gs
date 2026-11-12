/**
 * API สำหรับ Cloudflare Worker — Deploy > New deployment > Web app
 *   Execute as: Me   |   Who has access: Anyone
 * ทุก request ต้องส่ง JSON { secret, action, ...params } และ secret ต้องตรงกับ API_SECRET
 */

const WRITE_ACTIONS = ['context', 'register', 'redeem', 'invite', 'photo', 'stage', 'wave', 'sell', 'table',
  'leadsResolve', 'lead', 'customer', 'follow', 'verify', 'seen'];

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_json' });
  }
  if (!body || body.secret !== prop('API_SECRET', '__unset__')) return json_({ ok: false, error: 'unauthorized' });
  const fn = API[body.action];
  if (!fn) return json_({ ok: false, error: 'unknown_action' });
  const needLock = WRITE_ACTIONS.indexOf(body.action) >= 0;
  const lock = LockService.getScriptLock();
  try {
    if (needLock) lock.waitLock(25000);
    return json_({ ok: true, data: fn(body) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    if (needLock) try { lock.releaseLock(); } catch (x) { /* ignore */ }
  }
}

function doGet() {
  return json_({ ok: true, service: 'durian-nonthaburi', time: new Date().toISOString() });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- helpers ---------- */

function userRows_(userId) {
  return readAll('users').filter(function (u) { return u.line_user_id === userId; });
}

function farmUser_(userId) {
  const rows = userRows_(userId).filter(function (u) { return u.role === 'farmer' || u.role === 'caretaker'; });
  return rows.length ? rows[rows.length - 1] : null;
}

function isOfficer_(userId) {
  return userRows_(userId).some(function (u) { return u.role === 'officer'; });
}

/** ผู้ใช้ต้องเป็นเจ้าของ/ผู้ดูแลสวนนั้น หรือเป็นเจ้าหน้าที่ */
function assertFarm_(userId, farmId) {
  const u = farmUser_(userId);
  if (u && u.farm_id === farmId) return u;
  if (isOfficer_(userId)) return { role: 'officer', farm_id: farmId };
  throw new Error('forbidden');
}

function lotRow_(lotId) {
  const l = findOne('lots', 'lot_id', lotId);
  if (!l) throw new Error('lot_not_found');
  return l;
}

function dabOf_(variety) {
  const d = findOne('variety_dab', 'variety', variety);
  return d ? { min: Number(d.dab_min) || 115, max: Number(d.dab_max) || 125 } : { min: 115, max: 125 };
}

function lotOut_(l) {
  return {
    lot_id: l.lot_id, farm_id: l.farm_id, variety: l.variety, wave: Number(l.wave) || 1,
    bloom_date: iso(l.bloom_date), harvest_from: iso(l.harvest_from), harvest_to: iso(l.harvest_to),
    stage: Number(l.stage) || 0, remaining: Number(l.remaining) || 0, status: l.status,
    last_photo_url: l.last_photo_url, updated_at: iso(l.updated_at)
  };
}

function farmOut_(f, publicOnly) {
  const o = {
    farm_id: f.farm_id, farm_name: f.farm_name, owner_name: f.owner_name, tambon: f.tambon,
    story: f.story, owner_photo_url: f.owner_photo_url, cover_photo_url: f.cover_photo_url,
    line_oa_id: f.line_oa_id, facebook_url: f.facebook_url, pickup: f.pickup,
    accepts_booking: truthy(f.accepts_booking), gap_gi_no: f.gap_gi_no, status: f.status
  };
  const exact = f.show_gps === 'exact';
  o.lat = !publicOnly || exact ? f.lat : '';
  o.lng = !publicOnly || exact ? f.lng : '';
  o.phone = !publicOnly || truthy(f.show_phone) ? f.phone : '';
  if (!publicOnly) {
    o.status_reason = f.status_reason;
    o.registered_at = iso(f.registered_at);
    o.auto_checks = f.auto_checks ? JSON.parse(f.auto_checks) : [];
  }
  return o;
}

function setBloom_(lot, when) {
  const d = dabOf_(lot.variety);
  return { bloom_date: when, harvest_from: addDays(when, d.min), harvest_to: addDays(when, d.max) };
}

function logUpdate_(lot, patch, userId, source, photos, note) {
  const p = photos && photos.length ? photos[0] : {};
  appendObj('stage_updates', {
    update_id: newId('U'), at: new Date(), lot_id: lot.lot_id || '', farm_id: lot.farm_id, variety: lot.variety || '',
    stage: patch.stage !== undefined ? patch.stage : lot.stage, remaining: patch.remaining !== undefined ? patch.remaining : lot.remaining,
    photo_urls: (photos || []).map(function (x) { return x.url; }).join(' '),
    photo_lat: p.lat || '', photo_lng: p.lng || '', photo_taken_at: p.taken || '',
    by_user: userId, source: source || 'chat', note: note || ''
  });
}

function pointInPolygon_(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function distM_(a, b, c, d) {
  const r = 6371000, t = Math.PI / 180;
  const x = (d - b) * t * Math.cos((a + c) / 2 * t), y = (c - a) * t;
  return Math.sqrt(x * x + y * y) * r;
}

function newInvite_(farmId) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  appendObj('invites', { code: code, farm_id: farmId, created_at: new Date(), expires_at: addDays(new Date(), 1) });
  return code;
}

/* ---------- actions ---------- */

const API = {

  /** ข้อมูลทั้งหมดที่ฝั่งเกษตรกร/เจ้าหน้าที่ต้องใช้ในการตอบ 1 ครั้ง */
  context: function (b) {
    const out = { user: null, isOfficer: isOfficer_(b.userId), farm: null, varieties: [], lots: [], pendingLeads: 0, statusNote: null };
    const u = farmUser_(b.userId);
    if (!u) return out;
    out.user = { role: u.role, farm_id: u.farm_id, display_name: u.display_name };
    const f = findOne('farms', 'farm_id', u.farm_id);
    if (!f) return out;
    out.farm = farmOut_(f, false);
    const dab = readAll('variety_dab');
    out.varieties = readAll('farm_varieties').filter(function (v) { return v.farm_id === u.farm_id; }).map(function (v) {
      const d = dab.filter(function (x) { return x.variety === v.variety; })[0];
      return { variety: v.variety, trees: Number(v.trees) || 0, group: d ? d.group : 'heritage' };
    });
    out.lots = readAll('lots').filter(function (l) { return l.farm_id === u.farm_id && l.status !== 'closed'; }).map(lotOut_);
    out.pendingLeads = readAll('leads').filter(function (l) { return l.farm_id === u.farm_id && l.outcome === 'pending'; }).length;
    if (!truthy(f.status_notified) && f.status !== 'pending') {
      out.statusNote = { status: f.status, reason: f.status_reason };
      patchRow('farms', f._row, { status_notified: true });
    }
    return out;
  },

  /** ลงทะเบียนสวนจากหน้า LIFF (userId มาจาก ID token ที่ Worker ตรวจแล้ว) */
  register: function (b) {
    const f = b.form || {};
    if (farmUser_(b.userId)) throw new Error('บัญชี LINE นี้ผูกกับสวนอื่นแล้ว');
    ['farm_name', 'owner_name', 'tambon', 'phone'].forEach(function (k) {
      if (!f[k] || !String(f[k]).trim()) throw new Error('ข้อมูลไม่ครบ: ' + k);
    });
    if (!f.pdpa) throw new Error('ต้องยินยอม PDPA');
    const vars = (f.varieties || []).filter(function (v) { return v && v.variety && Number(v.trees) > 0; });
    if (!vars.length) throw new Error('ต้องมีอย่างน้อย 1 พันธุ์ พร้อมจำนวนต้น');

    const checks = [];
    const lat = Number(f.lat), lng = Number(f.lng);
    const hasPin = !isNaN(lat) && !isNaN(lng) && lat !== 0;
    const poly = prop('DISTRICT_POLYGON', '');
    if (!hasPin) checks.push(['wa', 'ไม่ได้ปักหมุดตอนลงทะเบียน']);
    else if (poly) checks.push(pointInPolygon_(lat, lng, JSON.parse(poly)) ? ['ok', 'หมุดอยู่ในเขตอำเภอ'] : ['no', 'หมุดอยู่นอกเขตอำเภอ']);
    else checks.push(['wa', 'ยังไม่ได้ตั้งขอบเขตอำเภอ (DISTRICT_POLYGON) ตรวจพิกัดด้วยตา']);
    const digits = String(f.phone).replace(/\D/g, '');
    const farms = readAll('farms');
    const dupPhone = farms.filter(function (x) { return String(x.phone).replace(/\D/g, '') === digits; })[0];
    const dupPin = hasPin && farms.filter(function (x) { return x.lat && distM_(lat, lng, Number(x.lat), Number(x.lng)) < 50; })[0];
    if (dupPhone) checks.push(['wa', 'เบอร์โทรซ้ำกับ ' + dupPhone.farm_id]);
    if (dupPin) checks.push(['wa', 'หมุดใกล้กับ ' + dupPin.farm_id + ' (ไม่เกิน 50 ม.)']);
    if (!dupPhone && !dupPin) checks.push(['ok', 'ไม่ซ้ำกับสวนที่ลงทะเบียนแล้ว']);

    const id = nextFarmId_();
    const now = new Date();
    appendObj('farms', {
      farm_id: id, farm_name: String(f.farm_name).trim(), owner_name: String(f.owner_name).trim(), tambon: f.tambon,
      lat: hasPin ? lat : '', lng: hasPin ? lng : '', phone: f.phone, line_oa_id: f.line_oa_id || '', facebook_url: f.facebook_url || '',
      story: f.story || '', show_gps: f.show_gps === 'exact' ? 'exact' : 'tambon', show_phone: !!f.show_phone,
      pickup: f.pickup || '', accepts_booking: !!f.accepts_booking, pdpa_consent_at: now, status: 'pending',
      status_notified: true, auto_checks: JSON.stringify(checks), registered_at: now, registered_by: b.userId
    });
    vars.forEach(function (v) {
      appendObj('farm_varieties', { farm_id: id, variety: v.variety, trees: Number(v.trees), updated_at: now });
      appendObj('lots', { lot_id: newId('L'), farm_id: id, variety: v.variety, wave: 1, stage: 0, remaining: 0,
        sold_total: 0, lost_total: 0, status: 'open', updated_at: now, updated_by: b.userId });
    });
    appendObj('users', { line_user_id: b.userId, role: 'farmer', farm_id: id, display_name: b.displayName || f.owner_name, added_at: now, via: 'register' });
    const code = newInvite_(id);
    audit(b.userId, 'register', id, { checks: checks });
    return { farm_id: id, invite_code: code, checks: checks };
  },

  /** ลูกหลานใช้รหัสเชิญ 6 หลัก */
  redeem: function (b) {
    const inv = readAll('invites').filter(function (i) { return String(i.code) === String(b.code) && !i.used_by; })[0];
    if (!inv) throw new Error('รหัสไม่ถูกต้องหรือถูกใช้ไปแล้ว');
    if (new Date(inv.expires_at) < new Date()) throw new Error('รหัสหมดอายุแล้ว ขอรหัสใหม่จากเจ้าของสวน');
    if (farmUser_(b.userId)) throw new Error('บัญชี LINE นี้ผูกกับสวนแล้ว');
    patchRow('invites', inv._row, { used_by: b.userId, used_at: new Date() });
    appendObj('users', { line_user_id: b.userId, role: 'caretaker', farm_id: inv.farm_id, display_name: b.displayName || '', added_at: new Date(), via: 'invite' });
    audit(b.userId, 'redeem', inv.farm_id, '');
    const f = findOne('farms', 'farm_id', inv.farm_id);
    return { farm_id: inv.farm_id, farm_name: f ? f.farm_name : '' };
  },

  invite: function (b) {
    const u = farmUser_(b.userId);
    if (!u || u.role !== 'farmer') throw new Error('เฉพาะเจ้าของสวน');
    return { code: newInvite_(u.farm_id) };
  },

  /** บันทึกรูป: lotId ว่าง = รูปบรรยากาศสวน */
  photo: function (b) {
    assertFarm_(b.userId, b.farmId);
    const photos = b.photos || [];
    if (!b.lotId) {
      const f = findOne('farms', 'farm_id', b.farmId);
      if (f && !f.cover_photo_url && photos[0]) patchRow('farms', f._row, { cover_photo_url: photos[0].url });
      logUpdate_({ farm_id: b.farmId }, {}, b.userId, 'chat', photos, 'farm_photo');
      return { ok: true };
    }
    const l = lotRow_(b.lotId);
    if (l.farm_id !== b.farmId) throw new Error('forbidden');
    if (photos[0]) patchRow('lots', l._row, { last_photo_url: photos[photos.length - 1].url, updated_at: new Date(), updated_by: b.userId });
    logUpdate_(l, {}, b.userId, 'chat', photos, 'photo');
    return lotOut_(lotRow_(b.lotId));
  },

  /** เปลี่ยนระยะ (และจำนวนผลถ้าส่งมา) */
  stage: function (b) {
    const l = lotRow_(b.lotId);
    assertFarm_(b.userId, l.farm_id);
    const s = Math.max(0, Math.min(4, Number(b.stage)));
    const patch = { stage: s, updated_at: new Date(), updated_by: b.userId };
    if (b.remaining !== undefined && b.remaining !== null && b.remaining !== '') patch.remaining = Math.max(0, Number(b.remaining));
    if (s >= 1 && !l.bloom_date) Object.assign(patch, setBloom_(l, new Date()));
    if (s === 4) patch.status = 'closed';
    if (b.photos && b.photos.length) patch.last_photo_url = b.photos[b.photos.length - 1].url;
    patchRow('lots', l._row, patch);
    logUpdate_(l, patch, b.userId, b.source || 'chat', b.photos || [], 'stage');
    return lotOut_(lotRow_(b.lotId));
  },

  /** ดอกบาน: ใช้รุ่นที่ยังไม่ออกดอก หรือสร้างรุ่นใหม่ */
  wave: function (b) {
    assertFarm_(b.userId, b.farmId);
    const all = readAll('lots').filter(function (l) { return l.farm_id === b.farmId && l.variety === b.variety; });
    const now = new Date();
    const zero = all.filter(function (l) { return l.status !== 'closed' && Number(l.stage) === 0; })[0];
    if (zero) {
      const patch = Object.assign({ stage: 1, updated_at: now, updated_by: b.userId }, setBloom_(zero, now));
      patchRow('lots', zero._row, patch);
      logUpdate_(zero, patch, b.userId, 'chat', [], 'bloom');
      return lotOut_(lotRow_(zero.lot_id));
    }
    const wave = all.reduce(function (m, l) { return Math.max(m, Number(l.wave) || 1); }, 0) + 1;
    const lot = Object.assign({ lot_id: newId('L'), farm_id: b.farmId, variety: b.variety, wave: wave, stage: 1, remaining: 0,
      sold_total: 0, lost_total: 0, status: 'open', updated_at: now, updated_by: b.userId }, setBloom_({ variety: b.variety }, now));
    appendObj('lots', lot);
    if (!findOne('farm_varieties', 'farm_id', b.farmId) ||
        !readAll('farm_varieties').some(function (v) { return v.farm_id === b.farmId && v.variety === b.variety; })) {
      appendObj('farm_varieties', { farm_id: b.farmId, variety: b.variety, trees: 0, updated_at: now });
    }
    logUpdate_(lot, {}, b.userId, 'chat', [], 'new_wave');
    return lotOut_(lotRow_(lot.lot_id));
  },

  /** ขาย/จองแล้ว: qty ลูก หรือ close=true ปิดรุ่น */
  sell: function (b) {
    const l = lotRow_(b.lotId);
    assertFarm_(b.userId, l.farm_id);
    const qty = Math.max(0, Number(b.qty) || 0);
    const rem = Math.max(0, (Number(l.remaining) || 0) - qty);
    const patch = { remaining: rem, sold_total: (Number(l.sold_total) || 0) + qty, updated_at: new Date(), updated_by: b.userId };
    if (b.close || rem === 0) { patch.stage = 4; patch.status = 'closed'; }
    patchRow('lots', l._row, patch);
    logUpdate_(l, patch, b.userId, 'chat', [], b.close ? 'close' : 'sold ' + qty);
    readAll('leads').forEach(function (x) {
      if (x.farm_id === l.farm_id && x.outcome === 'pending') patchRow('leads', x._row, { outcome: 'sold', resolved_at: new Date() });
    });
    return lotOut_(lotRow_(b.lotId));
  },

  /** หน้าอัปเดตแบบตาราง: items = [{lot_id, stage, remaining}] */
  table: function (b) {
    const changed = [];
    (b.items || []).forEach(function (it) {
      const l = lotRow_(it.lot_id);
      assertFarm_(b.userId, l.farm_id);
      if (Number(l.stage) === Number(it.stage) && Number(l.remaining) === Number(it.remaining)) return;
      API.stage({ userId: b.userId, lotId: it.lot_id, stage: it.stage, remaining: it.remaining, source: 'table' });
      changed.push(it.lot_id);
    });
    return { changed: changed };
  },

  leadsResolve: function (b) {
    const u = farmUser_(b.userId);
    if (!u) throw new Error('forbidden');
    let n = 0;
    readAll('leads').forEach(function (x) {
      if (x.farm_id === u.farm_id && x.outcome === 'pending') { patchRow('leads', x._row, { outcome: b.outcome || 'not_sold', resolved_at: new Date() }); n++; }
    });
    return { resolved: n };
  },

  /** ลูกค้ากดติดต่อสวน */
  lead: function (b) {
    const f = findOne('farms', 'farm_id', b.farmId);
    if (!f || f.status !== 'verified') throw new Error('farm_not_available');
    appendObj('leads', { lead_id: newId('LD'), at: new Date(), customer_id: b.customerId, farm_id: b.farmId, variety: b.variety || '',
      lot_id: b.lotId || '', channel: b.channel || 'chat', outcome: 'pending' });
    return farmOut_(f, true);
  },

  customer: function (b) {
    const c = findOne('customers', 'line_user_id', b.userId);
    if (c) patchRow('customers', c._row, { last_seen: new Date(), display_name: b.displayName || c.display_name });
    else appendObj('customers', { line_user_id: b.userId, display_name: b.displayName || '', first_seen: new Date(), last_seen: new Date() });
    return { ok: true };
  },

  follow: function (b) {
    const exists = readAll('follows').some(function (x) { return x.line_user_id === b.customerId && x.farm_id === b.farmId && x.variety === b.variety; });
    if (!exists) appendObj('follows', { line_user_id: b.customerId, farm_id: b.farmId, variety: b.variety, at: new Date() });
    return { ok: true };
  },

  follows: function (b) {
    return readAll('follows').filter(function (x) { return x.line_user_id === b.customerId; })
      .map(function (x) { return { farm_id: x.farm_id, variety: x.variety }; });
  },

  /** เจ้าหน้าที่: รายการสวนรอยืนยัน */
  pending: function (b) {
    if (!isOfficer_(b.userId)) throw new Error('forbidden');
    const fv = readAll('farm_varieties');
    return readAll('farms').filter(function (f) { return f.status === 'pending' || f.status === 'need_info'; })
      .map(function (f) {
        const o = farmOut_(f, false);
        o.varieties = fv.filter(function (v) { return v.farm_id === f.farm_id; }).map(function (v) { return { variety: v.variety, trees: Number(v.trees) || 0 }; });
        return o;
      });
  },

  verify: function (b) {
    if (!isOfficer_(b.userId)) throw new Error('forbidden');
    if (['verified', 'need_info', 'rejected'].indexOf(b.decision) < 0) throw new Error('bad_decision');
    const f = findOne('farms', 'farm_id', b.farmId);
    if (!f) throw new Error('farm_not_found');
    patchRow('farms', f._row, { status: b.decision, status_reason: b.reason || '', status_notified: false,
      verified_by: b.userId, verified_at: new Date() });
    audit(b.userId, 'verify:' + b.decision, b.farmId, b.reason || '');
    return { farm_id: b.farmId, status: b.decision };
  },

  /** บันทึกว่าผู้ใช้ทักบอท (ใช้หา LINE userId ของเจ้าหน้าที่ใหม่) */
  seen: function (b) {
    audit(b.userId, 'seen:' + (b.channel || ''), '', b.displayName || '');
    return { ok: true };
  },

  /** ข้อมูลสาธารณะทั้งหมด — Worker ดึงทุก 5 นาทีเก็บใน KV */
  snapshot: function () {
    const farms = readAll('farms').filter(function (f) { return f.status === 'verified'; });
    const ids = farms.map(function (f) { return f.farm_id; });
    const cutoff = addDays(new Date(), -60);
    const fv = readAll('farm_varieties').filter(function (v) { return ids.indexOf(v.farm_id) >= 0; });
    const lots = readAll('lots').filter(function (l) {
      return ids.indexOf(l.farm_id) >= 0 && (l.status !== 'closed' || new Date(l.updated_at) > cutoff);
    });
    const ups = readAll('stage_updates').filter(function (u) { return u.photo_urls && ids.indexOf(u.farm_id) >= 0; });
    const photos = [];
    ids.forEach(function (id) {
      ups.filter(function (u) { return u.farm_id === id; }).slice(-24).forEach(function (u) {
        String(u.photo_urls).split(' ').filter(String).forEach(function (url) {
          photos.push({ farm_id: id, lot_id: u.lot_id, variety: u.variety, stage: Number(u.stage) || 0, url: url, at: iso(u.at) });
        });
      });
    });
    return {
      generated_at: new Date().toISOString(),
      varieties: readAll('variety_dab').filter(function (v) { return truthy(v.active); })
        .map(function (v) { return { variety: v.variety, group: v.group, dab_min: Number(v.dab_min), dab_max: Number(v.dab_max) }; }),
      farms: farms.map(function (f) {
        const o = farmOut_(f, true);
        o.trees = {};
        fv.filter(function (v) { return v.farm_id === f.farm_id; }).forEach(function (v) { o.trees[v.variety] = Number(v.trees) || 0; });
        return o;
      }),
      lots: lots.map(lotOut_),
      photos: photos
    };
  }
};

/** แจ้งเตือนเจ้าหน้าที่ทางอีเมลทุกเช้า (ตั้งด้วย createTriggers) */
function dailyPendingEmail() {
  const to = prop('OFFICER_EMAILS', '');
  if (!to) return;
  const p = readAll('farms').filter(function (f) { return f.status === 'pending'; });
  if (!p.length) return;
  const lines = p.map(function (f) {
    const c = f.auto_checks ? JSON.parse(f.auto_checks) : [];
    const warn = c.filter(function (x) { return x[0] !== 'ok'; }).map(function (x) { return x[1]; }).join(', ');
    return '- ' + f.farm_id + ' ' + f.farm_name + ' (' + f.tambon + ')' + (warn ? ' — ตรวจ: ' + warn : ' — ตรวจอัตโนมัติผ่าน');
  });
  MailApp.sendEmail(to, 'สวนทุเรียนรอยืนยัน ' + p.length + ' สวน',
    'มีสวนรอเจ้าหน้าที่ยืนยัน:\n\n' + lines.join('\n') + '\n\nยืนยันได้ใน LINE OA เกษตรกร พิมพ์ "สวนรอยืนยัน"');
}

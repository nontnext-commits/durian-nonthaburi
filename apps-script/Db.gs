/** ตัวช่วยอ่าน/เขียนตารางแบบใช้ชื่อคอลัมน์ */

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบแท็บ ' + name + ' — รัน setupDatabase ก่อน');
  return sh;
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

/** อ่านทุกแถวเป็น object (มี _row = เลขแถวในชีต) */
function readAll(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const h = headers_(sh);
  const values = sh.getRange(2, 1, last - 1, h.length).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === '' || values[i][0] === null) continue;
    const o = { _row: i + 2 };
    for (let j = 0; j < h.length; j++) o[h[j]] = values[i][j];
    out.push(o);
  }
  return out;
}

function appendObj(name, obj) {
  const sh = sheet_(name);
  const h = headers_(sh);
  sh.appendRow(h.map(function (k) { return obj[k] === undefined || obj[k] === null ? '' : obj[k]; }));
  return obj;
}

function patchRow(name, row, obj) {
  const sh = sheet_(name);
  const h = headers_(sh);
  Object.keys(obj).forEach(function (k) {
    const c = h.indexOf(k);
    if (c >= 0) sh.getRange(row, c + 1).setValue(obj[k]);
  });
}

function findOne(name, key, value) {
  const rows = readAll(name);
  for (let i = 0; i < rows.length; i++) if (String(rows[i][key]) === String(value)) return rows[i];
  return null;
}

function newId(prefix) {
  return prefix + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase();
}

function nextFarmId_() {
  const rows = readAll('farms');
  let max = 0;
  rows.forEach(function (r) {
    const n = parseInt(String(r.farm_id).replace(/\D/g, ''), 10);
    if (n > max) max = n;
  });
  return 'DUR-' + ('00' + (max + 1)).slice(-3);
}

function audit(actor, action, ref, detail) {
  appendObj('audit_log', { at: new Date(), actor: actor || '', action: action, ref: ref || '',
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail || '') });
}

function iso(d) {
  if (!d) return '';
  if (Object.prototype.toString.call(d) === '[object Date]') return isNaN(d) ? '' : d.toISOString();
  return String(d);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + Number(n || 0));
  return x;
}

function truthy(v) {
  return v === true || String(v).toUpperCase() === 'TRUE' || v === 1 || v === '1';
}

/**
 * รันครั้งเดียวหลังสร้างไฟล์ Google Sheets ใหม่: เลือกฟังก์ชัน setupDatabase แล้วกด Run
 * สร้างแท็บทุกแท็บ หัวตาราง ช่องเลือก และค่าพันธุ์/DAB ตั้งต้น (รันซ้ำได้ ไม่ลบข้อมูลเดิม)
 */
function setupDatabase() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = SHEETS[name];
    const current = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    if (current.join('') === '') {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      headers.forEach(function (h) { // เติมคอลัมน์ที่ขาดไว้ท้ายตาราง (กรณีอัปเกรดเวอร์ชัน)
        if (current.indexOf(h) < 0) sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
      });
    }
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#f1efe8');
  });

  const dab = ss.getSheetByName('variety_dab');
  if (dab.getLastRow() < 2) {
    dab.getRange(2, 1, SEED_VARIETIES.length, 5)
      .setValues(SEED_VARIETIES.map(function (r) { return r.concat([true]); }));
  }

  const list = function (values) {
    return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  };
  const col = function (sheet, name) { return SHEETS[sheet].indexOf(name) + 1; };
  ss.getSheetByName('farms').getRange(2, col('farms', 'status'), 2000)
    .setDataValidation(list(['pending', 'verified', 'need_info', 'rejected']));
  ss.getSheetByName('farms').getRange(2, col('farms', 'show_gps'), 2000).setDataValidation(list(['exact', 'tambon']));
  ss.getSheetByName('lots').getRange(2, col('lots', 'stage'), 5000)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(0, 4).build());
  ss.getSheetByName('lots').getRange(2, col('lots', 'status'), 5000).setDataValidation(list(['open', 'closed']));
  ss.getSheetByName('users').getRange(2, col('users', 'role'), 2000)
    .setDataValidation(list(['farmer', 'caretaker', 'officer']));
  ss.getSheetByName('variety_dab').getRange(2, col('variety_dab', 'group'), 200)
    .setDataValidation(list(['popular', 'heritage']));

  const s1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่น1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  SpreadsheetApp.getUi && Logger.log('ตั้งค่าฐานข้อมูลเรียบร้อย');
}

/** เพิ่มเจ้าหน้าที่: แก้ค่าด้านล่างแล้วรัน (LINE userId ดูได้จากแท็บ audit_log หลังเจ้าหน้าที่ทักบอทครั้งแรก) */
function addOfficer() {
  const userId = 'Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const name = 'ชื่อเจ้าหน้าที่';
  appendObj('users', { line_user_id: userId, role: 'officer', farm_id: '', display_name: name, added_at: new Date(), via: 'manual' });
}

/** ตั้งเวลาแจ้งเตือนเจ้าหน้าที่ทุกวัน 08:00 (รันครั้งเดียว) */
function createTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyPendingEmail').timeBased().everyDays(1).atHour(8).create();
}

/** ข้อมูลตัวอย่างสำหรับทดสอบ (ไม่ต้องรันในระบบจริง) */
function seedDemoData() {
  const now = new Date();
  appendObj('farms', { farm_id: 'DUR-001', farm_name: 'สวนตัวอย่าง', owner_name: 'ทดสอบ ระบบ', tambon: 'ต.บางกร่าง',
    lat: 13.85, lng: 100.47, phone: '081-234-5678', show_gps: 'tambon', show_phone: true, pickup: 'รับเองที่สวน',
    accepts_booking: true, pdpa_consent_at: now, status: 'verified', status_notified: true, story: 'สวนตัวอย่างสำหรับทดสอบระบบ',
    registered_at: now, verified_by: 'seed', verified_at: now });
  appendObj('farm_varieties', { farm_id: 'DUR-001', variety: 'หมอนทอง', trees: 20, updated_at: now });
  appendObj('lots', { lot_id: newId('L'), farm_id: 'DUR-001', variety: 'หมอนทอง', wave: 1, stage: 3, remaining: 12,
    sold_total: 0, lost_total: 0, status: 'open', updated_at: now, updated_by: 'seed' });
}

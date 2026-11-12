/**
 * ระบบสารสนเทศทุเรียนนนท์ — Google Apps Script (ผูกกับไฟล์ Google Sheets)
 * หน้าที่: เป็นฐานข้อมูลกลาง + API ให้ Cloudflare Worker เรียกใช้
 *
 * Script Properties ที่ต้องตั้ง (Project Settings > Script properties):
 *   API_SECRET      รหัสลับยาว ๆ ใช้ร่วมกับ Worker (ตั้งค่าเดียวกับ GAS_SECRET ใน Worker)
 *   OFFICER_EMAILS  อีเมลเจ้าหน้าที่ คั่นด้วย comma สำหรับแจ้งเตือนสวนรอยืนยัน
 *   DISTRICT_POLYGON  (ไม่บังคับ) พิกัดขอบเขตอำเภอ JSON [[lat,lng],...] ใช้ตรวจว่าหมุดอยู่ในเขต
 */

const SHEETS = {
  farms: ['farm_id', 'farm_name', 'owner_name', 'tambon', 'lat', 'lng', 'phone', 'line_oa_id', 'facebook_url',
    'story', 'owner_photo_url', 'cover_photo_url', 'show_gps', 'show_phone', 'pickup', 'accepts_booking',
    'gap_gi_no', 'pdpa_consent_at', 'status', 'status_reason', 'status_notified', 'auto_checks',
    'verified_by', 'verified_at', 'registered_at', 'registered_by'],
  farm_varieties: ['farm_id', 'variety', 'trees', 'updated_at'],
  lots: ['lot_id', 'farm_id', 'variety', 'wave', 'bloom_date', 'harvest_from', 'harvest_to', 'stage',
    'remaining', 'sold_total', 'lost_total', 'status', 'last_photo_url', 'updated_at', 'updated_by'],
  stage_updates: ['update_id', 'at', 'lot_id', 'farm_id', 'variety', 'stage', 'remaining', 'photo_urls',
    'photo_lat', 'photo_lng', 'photo_taken_at', 'by_user', 'source', 'note'],
  variety_dab: ['variety', 'dab_min', 'dab_max', 'group', 'active'],
  users: ['line_user_id', 'role', 'farm_id', 'display_name', 'added_at', 'via'],
  invites: ['code', 'farm_id', 'created_at', 'expires_at', 'used_by', 'used_at'],
  customers: ['line_user_id', 'display_name', 'first_seen', 'last_seen', 'pdpa_consent_at'],
  follows: ['line_user_id', 'farm_id', 'variety', 'at'],
  leads: ['lead_id', 'at', 'customer_id', 'farm_id', 'variety', 'lot_id', 'channel', 'outcome', 'resolved_at'],
  audit_log: ['at', 'actor', 'action', 'ref', 'detail']
};

/** ระยะการพัฒนา (เก็บเป็นตัวเลขในคอลัมน์ stage) */
const STAGES = ['ยังไม่ออกดอก', 'ดอกบาน', 'ผลเล็ก', 'พร้อมตัด', 'หมด/ปิดรุ่น'];

/** ค่า DAB ตั้งต้น — ให้นักวิชาการในพื้นที่ตรวจและแก้ในแท็บ variety_dab ก่อนใช้จริง */
const SEED_VARIETIES = [
  ['หมอนทอง', 120, 130, 'popular'], ['ก้านยาว', 120, 135, 'popular'], ['ชะนี', 100, 110, 'popular'],
  ['กระดุมทอง', 90, 100, 'popular'], ['กบแม่เฒ่า', 110, 125, 'heritage'], ['ทองย้อยฉัตร', 110, 120, 'heritage'],
  ['กบตาขำ', 110, 120, 'heritage'], ['กำปั่นเหลือง', 110, 120, 'heritage'], ['กะเทยเนื้อเหลือง', 110, 120, 'heritage'],
  ['ลวง', 110, 120, 'heritage']
];

function prop(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === '' ? fallback : v;
}

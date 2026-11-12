# ระบบสารสนเทศทุเรียนนนท์

ระบบติดตามผลผลิตและส่งเสริมการตลาดทุเรียนนนท์ พร้อม AI ผู้ช่วยขายและเว็บ Storytelling รายสวน
โครงการนำร่อง สำนักงานเกษตรอำเภอ — ใช้บริการแพ็กเกจฟรีทั้งหมด ยกเว้นค่า AI (ประมาณ 500–1,300 บาท/ฤดู สำหรับลูกค้า 1,000 คน)

## ภาพรวม

```
เกษตรกร / เจ้าหน้าที่ ──▶ LINE OA เกษตรกร ──┐
                                           ├──▶ Cloudflare Worker ──▶ Apps Script API ──▶ Google Sheets
ลูกค้า ─────────────────▶ LINE OA ลูกค้า ───┘        │    │                       (ฐานข้อมูล 11 แท็บ)
                                                     │    └──▶ Cloudinary (รูป)
หน้า LIFF (ลงทะเบียน / ตาราง) ──▶ Worker /api/*        └──▶ AI (Claude Haiku หรือ Gemini)
เว็บ Storytelling (GitHub Pages) ──▶ Worker /api/public ◀── KV (สำเนาข้อมูล ดึงใหม่ทุก 5 นาที)
```

**ทำไม Worker รับ webhook ทั้ง 2 บัญชี:** Apps Script อ่าน header ของ request ไม่ได้ จึงตรวจลายเซ็น `X-Line-Signature` ไม่ได้ Worker จึงตรวจลายเซ็นก่อน แล้วค่อยเรียก Apps Script ด้วยรหัสลับ ส่วนฝั่งลูกค้าอ่านข้อมูลจากสำเนาใน KV จึงตอบเร็ว ไม่ต้องรอ Google Sheets

| โฟลเดอร์ | เนื้อหา | ติดตั้งที่ |
|---|---|---|
| `apps-script/` | สคริปต์สร้างฐานข้อมูล + API อ่าน/เขียน Sheets | Google Apps Script (ผูกกับไฟล์ Sheets) |
| `worker/` | บอท LINE ทั้ง 2 บัญชี, AI, อัปโหลดรูป, cache | Cloudflare Workers |
| `liff/` | หน้าลงทะเบียนสวน, หน้าอัปเดตแบบตาราง | GitHub Pages (เปิดผ่าน LIFF) |
| `web/` | เว็บ Storytelling สาธารณะ | GitHub Pages |
| `worker/test/` | ทดสอบทั้งระบบแบบจำลอง (ไม่ต้องต่อเน็ต) | เครื่องผู้พัฒนา |

## ฐานข้อมูล (Google Sheets)

รัน `setupDatabase()` ครั้งเดียว ระบบจะสร้างแท็บทั้งหมดพร้อมหัวตารางและช่องเลือกให้

| แท็บ | 1 แถว = | คอลัมน์สำคัญ |
|---|---|---|
| `farms` | 1 สวน | `farm_id` (DUR-001), ชื่อสวน, เจ้าของ, ตำบล, พิกัด, เบอร์โทร, เรื่องเล่า, รูปเจ้าของ/รูปสวน, `show_gps` (exact/tambon), `show_phone`, `status` (pending/verified/need_info/rejected), ผลตรวจอัตโนมัติ, ผู้ยืนยันและเวลา |
| `farm_varieties` | 1 พันธุ์ในสวน | `farm_id`, `variety`, `trees` (จำนวนต้นตอนลงทะเบียน) |
| `lots` | 1 รุ่นดอกของ 1 พันธุ์ | `lot_id`, `variety`, `wave` (รุ่นที่), `bloom_date`, `harvest_from/to` (คำนวณจาก DAB), `stage` 0–4, `remaining` (ผลคงเหลือ), `sold_total`, `status` (open/closed), `last_photo_url` |
| `stage_updates` | 1 การอัปเดต (เพิ่มแถวอย่างเดียว ไม่เขียนทับ) | เวลา, รุ่น, ระยะ, จำนวนผล, ลิงก์รูป, พิกัด/เวลาที่ฝังในรูป, ผู้บันทึก, ช่องทาง (chat/table) |
| `variety_dab` | 1 พันธุ์ (รายการกลาง) | `dab_min`, `dab_max` (วันหลังดอกบาน), `group` (popular/heritage), `active` |
| `users` | 1 คนต่อ 1 บทบาท | LINE userId, `role` (farmer/caretaker/officer), `farm_id` |
| `invites` | 1 รหัสเชิญ | รหัส 6 หลัก, สวน, วันหมดอายุ (24 ชม.), ผู้ใช้รหัส |
| `customers` | 1 ลูกค้า | LINE userId, ชื่อโปรไฟล์, วันที่เห็นครั้งแรก/ล่าสุด |
| `follows` | การติดตาม | ลูกค้า, สวน, พันธุ์ |
| `leads` | 1 ครั้งที่ลูกค้ากดติดต่อสวน | ลูกค้า, สวน, พันธุ์, รุ่น, `outcome` (pending/sold/not_sold) |
| `audit_log` | 1 เหตุการณ์ | ใครทำอะไรเมื่อไร (ลงทะเบียน, ยืนยัน, ทักบอทครั้งแรก) |

**ระยะ (`stage`):** 0 ยังไม่ออกดอก · 1 ดอกบาน · 2 ผลเล็ก (เปิดจองได้) · 3 พร้อมตัด · 4 หมด/ปิดรุ่น

**ค่า DAB ในแท็บ `variety_dab` เป็นค่าตั้งต้นเท่านั้น** ให้นักวิชาการในพื้นที่ตรวจและแก้ก่อนใช้จริง ระบบใช้ค่านี้คำนวณ "ช่วงคาดว่าจะตัด" เพื่อแจ้งลูกค้าเท่านั้น ไม่ใช่การรับรองความแก่ของผลผลิต

## ขั้นตอนติดตั้ง

> ทุกบริการให้สมัครด้วย **บัญชีเฉพาะโครงการ** (ไม่ใช้บัญชีส่วนตัว) เพื่อส่งมอบให้หน่วยงานหรือกลุ่มได้ทั้งชุด

### 1. Google Sheets + Apps Script

1. สร้างไฟล์ Google Sheets ใหม่ ตั้งชื่อ เช่น `ฐานข้อมูลทุเรียนนนท์`
2. เมนู **ส่วนขยาย > Apps Script** แล้วสร้างไฟล์ `Config.gs`, `Db.gs`, `Setup.gs`, `Api.gs` คัดลอกเนื้อหาจากโฟลเดอร์ `apps-script/`
3. **Project Settings > แสดงไฟล์ appsscript.json** แล้วแทนที่ด้วยไฟล์ในโฟลเดอร์นี้ (ตั้งเขตเวลา Asia/Bangkok)
4. **Project Settings > Script properties** เพิ่ม
   - `API_SECRET` = รหัสผ่านที่ตั้งขึ้นเอง (สุ่มอย่างน้อย 32 ตัวอักษร) — **ไม่ใช่ API Secret ของ Cloudinary** ต้องนำค่าเดียวกันนี้ไปใส่เป็น `GAS_SECRET` ของ Worker
   - `OFFICER_EMAILS` = อีเมลเจ้าหน้าที่ คั่นด้วย `,`
   - `DISTRICT_POLYGON` (ไม่บังคับ) = ขอบเขตอำเภอ เช่น `[[13.90,100.40],[13.90,100.55],[13.80,100.55],[13.80,100.40]]`
5. เลือกฟังก์ชัน `setupDatabase` แล้วกด **Run** (ครั้งแรกต้องกดอนุญาตสิทธิ์)
6. รัน `createTriggers` เพื่อตั้งอีเมลแจ้งสวนรอยืนยันทุกเช้า 08:00
7. **Deploy > New deployment > Web app** — Execute as: **Me**, Who has access: **Anyone** → คัดลอก URL ที่ได้ (ใช้เป็น `GAS_URL`)
   - แก้โค้ดภายหลัง ต้อง **Deploy > Manage deployments > แก้ไข > New version** ไม่อย่างนั้น URL เดิมยังใช้โค้ดเก่า

### 2. Cloudinary (เก็บรูป)

สมัครแพ็กเกจฟรีที่ cloudinary.com แล้วจด **Cloud name**, **API Key**, **API Secret** จากหน้า Dashboard
รูปที่แสดงต่อสาธารณะใช้ลิงก์แบบย่อขนาด ซึ่ง Cloudinary ตัดข้อมูล EXIF (รวมพิกัด GPS) ออก ส่วนพิกัดและเวลาถ่ายเก็บไว้ในแท็บ `stage_updates` ให้เจ้าหน้าที่ใช้ตรวจเท่านั้น

### 3. LINE

ทำใน LINE Developers Console โดยสร้างทุกอย่างไว้ใน **Provider เดียวกัน** (LINE userId ของคนเดียวกันจะตรงกันทุก channel ใน Provider เดียว)

1. **Messaging API channel: ทุเรียนนนท์ (เกษตรกร)** — จด Channel secret และออก Channel access token (long-lived)
2. **Messaging API channel: ทุเรียนนนท์ (ลูกค้า)** — จดค่าเหมือนกัน
3. **LINE Login channel** — จด Channel ID (ใช้เป็น `LINE_LOGIN_CHANNEL_ID`) แล้วเพิ่ม LIFF app 2 ตัว
   - ลงทะเบียน: Endpoint `https://<github-user>.github.io/durian-nonthaburi/liff/register.html`, Size **Full**, Scope `openid` + `profile`
   - อัปเดตแบบตาราง: Endpoint `.../liff/table.html`, Size **Full**, Scope `openid` + `profile`
   - จด LIFF ID ทั้งสอง
4. ใน **LINE Official Account Manager** ของทั้ง 2 บัญชี: ปิด "ข้อความตอบกลับอัตโนมัติ" และ "ข้อความทักทาย" แล้วเปิด **Webhook**

### 4. Cloudflare Worker

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create DATA        # นำ id ไปใส่ wrangler.toml
# แก้ค่าใน [vars] ของ wrangler.toml ให้ครบ
npx wrangler secret put GAS_URL
npx wrangler secret put GAS_SECRET            # ค่าเดียวกับ Script property API_SECRET ของ Apps Script
npx wrangler secret put LINE_FARMER_SECRET
npx wrangler secret put LINE_FARMER_TOKEN
npx wrangler secret put LINE_CUSTOMER_SECRET
npx wrangler secret put LINE_CUSTOMER_TOKEN
npx wrangler secret put CLOUDINARY_API_KEY
npx wrangler secret put CLOUDINARY_API_SECRET
npx wrangler secret put ANTHROPIC_API_KEY     # หรือ GEMINI_API_KEY ถ้าตั้ง AI_PROVIDER = "gemini"
npx wrangler deploy
```

จากนั้นใส่ Webhook URL ใน LINE Developers Console แล้วกด **Verify**
- บัญชีเกษตรกร: `https://durian-nonthaburi.<subdomain>.workers.dev/webhook/farmer`
- บัญชีลูกค้า: `https://durian-nonthaburi.<subdomain>.workers.dev/webhook/customer`

**ตั้งวงเงินสูงสุดต่อเดือน** ในบัญชี AI (เช่น 10 ดอลลาร์) เพื่อกันค่าใช้จ่ายเกินงบ

### 5. GitHub Pages (หน้า LIFF และเว็บ)

1. แก้ `liff/config.js` (WORKER_URL, LIFF ID, รายชื่อตำบล) และ `WORKER_URL` ใน `web/index.html`
2. push โปรเจกต์ขึ้น GitHub (บัญชีโครงการ) แล้วเปิด **Settings > Pages > Deploy from branch: main / root**
3. ตั้ง `WEB_URL` และ `ALLOWED_ORIGIN` ใน `wrangler.toml` ให้ตรงกับที่อยู่ GitHub Pages แล้ว `npx wrangler deploy` อีกครั้ง

### 6. Rich Menu (ทำใน LINE OA Manager ไม่ต้องเขียนโค้ด)

ตั้งปุ่มแบบ **"ข้อความ"** ให้ส่งคำต่อไปนี้ (บอทเข้าใจทั้งการพิมพ์และการกดปุ่ม)

| บัญชี | ปุ่ม (ข้อความที่ส่ง) |
|---|---|
| เกษตรกร | `สวนของฉัน` · `ส่งรูป` · `ดอกบาน` · `ขาย/จองแล้ว` · `อัปเดตแบบตาราง` · `วิธีใช้` |
| ลูกค้า | `สวนที่มีผลผลิต` · `พันธุ์โบราณ` · `สวนที่ติดตาม` · ลิงก์ไปเว็บ Storytelling |

### 7. เพิ่มเจ้าหน้าที่

1. เจ้าหน้าที่เพิ่มเพื่อน LINE OA เกษตรกร แล้วพิมพ์อะไรก็ได้ 1 ครั้ง
2. เปิดแท็บ `audit_log` จะเห็นแถว `seen:farmer` พร้อม LINE userId (ขึ้นต้นด้วย U)
3. เพิ่มแถวในแท็บ `users`: `line_user_id` = userId นั้น, `role` = `officer`
4. เจ้าหน้าที่พิมพ์ `สวนรอยืนยัน` เพื่อเปิดรายการตรวจ

## สิ่งที่บอททำได้

**เกษตรกร:** ส่งรูปในแชต → เลือกพันธุ์ → เลือกระยะ ระบบหารุ่นให้เอง · `ดอกบาน` เริ่มรุ่นใหม่พร้อมคำนวณช่วงคาดตัด · `ขาย/จองแล้ว` ตัดสต็อก · `สวนของฉัน` ดูทุกพันธุ์ทุกรุ่น · `รหัสเชิญ` ออกรหัสให้ลูกหลาน · เมื่อมีลูกค้ากดติดต่อสวน บอทจะถามผลการขายตอนเกษตรกรทักมาครั้งถัดไป

**เจ้าหน้าที่:** `สวนรอยืนยัน` → การ์ดสวนพร้อมผลตรวจอัตโนมัติ (หมุดในเขต, ข้อมูลซ้ำ) → ยืนยัน / ขอข้อมูลเพิ่ม / ไม่ผ่าน (พร้อมเหตุผล) → เกษตรกรเห็นผลตอนทักบอทครั้งถัดไป

**ลูกค้า:** ค้นหาตามพันธุ์ (ยอดนิยม 4 พันธุ์ + พันธุ์โบราณ) · การ์ดสวนแสดงรูปล่าสุด รุ่นที่มีของ และรุ่นถัดไป · ติดต่อสวน (บันทึก lead) · ติดตามสวน · พิมพ์ถาม AI (ไม่บอกราคา ไม่รับรองคุณภาพ จำกัด 30 คำถาม/คน/วัน)

**ทุกข้อความเป็นการตอบกลับ (Reply) ไม่มีการส่ง Push จึงไม่มีค่าข้อความ**

## ทดสอบ

```bash
cd worker
npm test
```

รันโค้ด Apps Script จริงบน Google Sheets จำลอง และยิง LINE webhook จำลองครบทุกขั้นตอน (ลงทะเบียน → รหัสเชิญ → เจ้าหน้าที่ยืนยัน → ดอกบานหลายรุ่น → ส่งรูป → ตัดสต็อก → หน้าตาราง → ลูกค้าค้นหา/ติดต่อ/ติดตาม/ถาม AI → ถามผล lead) พร้อมตรวจข้อจำกัดข้อความของ LINE

## ข้อจำกัดที่ควรรู้

| เรื่อง | รายละเอียด |
|---|---|
| Cloudflare KV ฟรี | เขียนได้ 1,000 ครั้ง/วัน, ลบ 1,000, list 1,000 ระบบเขียน snapshot เฉพาะเมื่อข้อมูลเปลี่ยน และนับคำถาม AI ด้วย Cache API แทน รูป 1 รูปใช้ 1 เขียน + 1 ลบ |
| Worker ฟรี | 100,000 request/วัน, CPU 10 ms ต่อครั้ง (เวลารอ AI/Sheets ไม่นับเป็น CPU) |
| ความเร็วฝั่งเกษตรกร | ต้องรอ Apps Script ประมาณ 1–3 วินาทีต่อครั้ง (ฝั่งลูกค้าอ่านจาก KV จึงเร็วกว่า) |
| ส่งรูปหลายรูปพร้อมกัน | รูปเก็บรอใน KV 15 นาที ถ้าเกษตรกรเลือกพันธุ์ช้ากว่านั้น ต้องส่งรูปใหม่ |
| ข้อมูลฝั่งลูกค้า | อัปเดตทันทีหลังเกษตรกรบันทึกหรือเจ้าหน้าที่ยืนยัน และดึงใหม่ทุก 5 นาทีเผื่อมีการแก้ในชีตโดยตรง |
| Google Sheets | เหมาะกับสวนระดับหลักร้อย ถ้าเกินหลายพันแถวต่อแท็บ ควรย้ายไป Firestore/Supabase (โครงสร้างตารางย้ายได้ตรง ๆ) |

## ก่อนส่งมอบ

- [ ] ทุกบริการอยู่ในบัญชีโครงการ และมีผู้ดูแลอย่างน้อย 2 คน
- [ ] จดรหัสผ่าน/ค่าลับไว้ในที่ปลอดภัยที่ผู้รับมอบเข้าถึงได้
- [ ] ค่า DAB ผ่านการตรวจของนักวิชาการ
- [ ] ประกาศความเป็นส่วนตัว (PDPA) บนเว็บ และระบุผู้รับโอนข้อมูลหลังจบโครงการ
- [ ] เกณฑ์การเรียงสวนเปิดเผยบนเว็บ (มีอยู่ในส่วนท้ายเว็บแล้ว)

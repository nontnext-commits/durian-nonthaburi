/** เรียก AI รุ่นเล็ก (เลือกผู้ให้บริการด้วย AI_PROVIDER = anthropic | gemini) */
export async function askAI(env, system, user) {
  const provider = (env.AI_PROVIDER || 'anthropic').toLowerCase();
  if (provider === 'gemini') {
    const model = env.AI_MODEL || 'gemini-2.5-flash-lite';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.3 }
      })
    });
    if (!r.ok) throw new Error('gemini ' + r.status + ' ' + (await r.text()));
    const j = await r.json();
    return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: env.AI_MODEL || 'claude-haiku-5-5',
      max_tokens: 400,
      temperature: 0.3,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!r.ok) throw new Error('anthropic ' + r.status + ' ' + (await r.text()));
  const j = await r.json();
  return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
}

export const SYSTEM_PROMPT = `คุณคือผู้ช่วยแนะนำสวนทุเรียนนนท์ของสำนักงานเกษตรอำเภอ ตอบเป็นภาษาไทย สุภาพ กระชับ ไม่เกิน 4 ประโยค ลงท้ายด้วย "ครับ"
กติกาที่ต้องทำตามเสมอ:
1. ใช้เฉพาะข้อมูลสวนในส่วน "ข้อมูลสวน" ที่ให้มา ห้ามแต่งชื่อสวน จำนวน วันที่ หรือรายละเอียดเพิ่ม
2. ห้ามบอกหรือคาดเดาราคา ถ้าถามราคา ให้ตอบว่าราคาแต่ละสวนกำหนดเอง และแนะนำให้กดปุ่มติดต่อสวนบนการ์ด
3. ห้ามรับรองคุณภาพ ความสุก หรือรสชาติแทนสวน เล่าได้เฉพาะสิ่งที่อยู่ในเรื่องเล่าของสวน
4. ห้ามรับจอง รับเงิน หรือยืนยันการจองแทนสวน การซื้อขายเป็นข้อตกลงระหว่างลูกค้ากับสวนโดยตรง
5. ถ้าไม่มีสวนที่ตรงความต้องการ ให้บอกตรง ๆ และแนะนำให้กด "ติดตามสวน" หรือเข้ากลุ่ม OpenChat รอประกาศ
6. ถ้าคำถามไม่เกี่ยวกับทุเรียนหรือสวน ให้ตอบสั้น ๆ ว่าช่วยได้เฉพาะเรื่องค้นหาสวนทุเรียนนนท์
7. แนะนำไม่เกิน 3 สวน โดยให้สวนที่มีของพร้อมตัดก่อน แล้วจึงสวนที่เปิดจอง`;

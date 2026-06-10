# outsource-monitor

เครื่องมือช่วยตรวจโค้ดที่ vendor (outsource) ส่งมอบ **รายเดือน** — เทียบโค้ดเดือนนี้กับเดือนก่อน
ให้ **AI วิเคราะห์** ว่ามีอะไรเปลี่ยน อันไหนตรงกับ request-change ที่เราขอไป อันไหนเป็นงานหลัก/นอกเหนือ
แล้วสรุปเป็นรายงานส่ง **อีเมล** ให้อัตโนมัติ

## มันทำอะไร

```
2 git branch (เดือนก่อน → เดือนนี้)
        │
        ▼
  git diff รายไฟล์
        │
        ├─ [Stage 1] อ่าน base docs → model เล็กสรุปว่าโปรเจกต์ทำอะไร + ศัพท์เฉพาะ
        ├─ อ่าน request-change doc ของรอบนั้น (.md/.txt/.pdf)
        ▼
  [Stage 2] วิเคราะห์ทีละไฟล์ แบบ refine chain หลายโมเดล
            deepseek (draft) → xai (ตรวจทาน) → openai-mini (สรุป)
            จัดกลุ่ม: ตามที่ขอ / งานหลัก / นอกเหนือ / refactor / config
        │
        ▼
  [Stage 3] openai gpt-4o (ตัวใหญ่) เรียบเรียงสรุป/อีเมล
        ▼
  รายงาน .md → (เลือก) ส่งอีเมลผ่าน Microsoft Graph
```

AI เรียกผ่าน **develyst-ai gateway** — ค่าเริ่มต้นชี้ไป server `https://ai.develyst.online`
(จะใช้ local `http://localhost:3009` ก็ได้ ตั้งใน `.env`)
อีเมลส่งผ่าน **Microsoft Graph** (client-credentials)

### Pipeline หลายสเตจ (ปรับได้ใน `.env`)
ใช้ model เล็กราคาถูกคิดวิเคราะห์ซ้ำหลายรอบ/หลายตัว แล้วให้ model ใหญ่เขียนข้อความตอนท้าย:
- `AI_CONTEXT_MODEL` — Stage 1 เข้าใจ docs
- `AI_ANALYZE_CHAIN` — Stage 2 chain ของโมเดล (คั่นด้วย comma) ตัวแรก draft ตัวถัด ๆ ตรวจทาน/แก้
- `AI_WRITER_MODEL` — Stage 3 เรียบเรียงสรุป
รูปแบบค่า: `provider` หรือ `provider:model` เช่น `openai:gpt-4o`

## เตรียมก่อนใช้

1. ติดตั้ง dependency: `bun install`
2. คัดลอก `.env.example` เป็น `.env` แล้วเติมค่า (AI gateway URL, Microsoft Graph credentials, ผู้รับอีเมล)
3. AI gateway: ค่าเริ่มต้นใช้ server `https://ai.develyst.online` (ไม่ต้องรันเอง)
   ถ้าอยากรัน local: `cd C:\Users\Admin\develyst\develyst-ai && bun run dev` แล้วตั้ง `AI_GATEWAY_URL=http://localhost:3009`

## การใช้งานรายเดือน

### 1) (ทางเลือก) เอาโค้ดที่ vendor ส่งมาขึ้น branch ใหม่
```
bun run src/index.ts import --repo ../vendor-repo --from "C:\delivery\2026-06" --branch 2026-06 --yes
```
ไม่ใส่ `--yes` = dry-run (แสดงว่าจะทำอะไร ยังไม่เขียนจริง)

### 2) วิเคราะห์ + ส่งรายงาน
```
bun run src/index.ts analyze \
  --repo ../vendor-repo \
  --base 2026-05 \
  --head 2026-06 \
  --cr docs/change-requests/2026-06.md \
  --send-email
```

- รายงาน `.md` จะถูกเก็บใน `reports/`
- `--send-email` จะเคารพ `EMAIL_SEND_ENABLED` ใน `.env`
  (`false` = โหมดทดสอบ สร้างรายงานแต่ไม่ส่งจริง — ปลอดภัยสำหรับลองครั้งแรก)

## request-change doc

แต่ละเดือนสร้างไฟล์ เช่น `docs/change-requests/2026-06.md` ระบุสิ่งที่ขอให้ vendor แก้
(ดูตัวอย่างที่ `docs/change-requests/2026-06.example.md`)
รองรับ `.md` / `.txt` และ `.pdf` (ต้องมี `pdftotext`/poppler ในเครื่อง)

## โครงสร้างโค้ด

| ไฟล์ | หน้าที่ |
|---|---|
| `src/index.ts` | CLI (`analyze`, `import`) |
| `src/config.ts` | โหลดค่าจาก `.env` |
| `src/ai.ts` | เรียก develyst-ai gateway + parse JSON |
| `src/git.ts` | diff 2 ref, อ่านไฟล์ที่ ref |
| `src/context.ts` | รวบรวม base docs → ให้ AI สรุปบริบทโปรเจกต์ |
| `src/changeRequest.ts` | โหลด request-change doc (md/txt/pdf) |
| `src/analyze.ts` | orchestrator: วิเคราะห์รายไฟล์ + สรุปภาพรวม |
| `src/report.ts` | สร้างรายงาน markdown + HTML |
| `src/email.ts` | ส่งอีเมลผ่าน Microsoft Graph |

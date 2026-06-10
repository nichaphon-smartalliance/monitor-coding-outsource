# outsource-monitor

เครื่องมือช่วยตรวจโค้ดที่ vendor (outsource) ส่งมอบเป็นรอบ ๆ — เทียบโค้ดรอบนี้กับรอบก่อน
ให้ **AI วิเคราะห์** ว่ามีอะไรเปลี่ยน อันไหนตรงกับ request-change ที่เราขอไป อันไหนเป็นงานหลัก/นอกเหนือ
แล้วสรุปเป็นรายงานส่ง **อีเมล** ให้อัตโนมัติ — **รองรับหลายโปรเจกต์** (ตั้งค่าโปรเจกต์ละ 1 ไฟล์)

แต่ละโปรเจกต์มี 2 เอกสารอ้างอิง:
- **Project Requirement** — สเปกตั้งต้น (ช่วยให้ AI เข้าใจว่าระบบควรทำอะไร)
- **Request-Change Backlog** — รายการที่ขอแก้ แบบสะสม **ไม่ผูกกับเดือน** (CR ที่ขอนานแล้วเพิ่งทำเสร็จได้)

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

## ตั้งค่าโปรเจกต์ (ทำครั้งเดียวต่อโปรเจกต์)

สร้างไฟล์ `projects/<id>.json` (ดูตัวอย่าง `projects/example.json`):
```json
{
  "name": "ShopX Backend",
  "repo": "../shopx-delivery",
  "requirementDoc": "docs/shopx/requirement.md",
  "changeRequests": "docs/shopx/change-requests.md",
  "emailTo": ["md@smartalliance.co.th"]
}
```
- `repo` = git repo ที่เก็บโค้ดส่งมอบ (แต่ละรอบ = 1 branch) — path relative อิงจาก root ของเครื่องมือ หรือใส่ absolute
- `requirementDoc` / `changeRequests` = path ไปเอกสาร 2 ไฟล์ (.md/.txt/.pdf)

ดูโปรเจกต์ทั้งหมด: `bun run src/index.ts projects`

## การใช้งานแต่ละรอบส่งมอบ

### 1) (ทางเลือก) เอาโค้ดที่ vendor ส่งมาขึ้น branch ใหม่
```
bun run src/index.ts import --project shopx --from "C:\delivery\rd4" --branch delivery-4 --yes
```
ไม่ใส่ `--yes` = dry-run (แสดงว่าจะทำอะไร ยังไม่เขียนจริง)

### 2) วิเคราะห์ + ส่งรายงาน
```
bun run src/index.ts analyze --project shopx --base delivery-3 --head delivery-4 --send-email
```

- รายงาน `.md` จะถูกเก็บใน `reports/`
- `--send-email` จะเคารพ `EMAIL_SEND_ENABLED` ใน `.env`
  (`false` = โหมดทดสอบ สร้างรายงานแต่ไม่ส่งจริง — ปลอดภัยสำหรับลองครั้งแรก)
- ไม่อยากใช้ `--project` ก็ระบุเองได้: `--repo <path> --requirement <doc> --cr <doc>`

## เอกสาร 2 ไฟล์ต่อโปรเจกต์

- **requirement** — สเปกตั้งต้น แทบไม่เปลี่ยน (ตัวอย่าง `docs/example/requirement.md`)
- **change-requests** — backlog ที่ขอแก้ สะสมไม่ผูกเดือน ใส่สถานะกำกับได้ (ตัวอย่าง `docs/example/change-requests.md`)

รองรับ `.md` / `.txt` และ `.pdf` (PDF ต้องมี `pdftotext`/poppler ในเครื่อง)

## โครงสร้างโค้ด

| ไฟล์ | หน้าที่ |
|---|---|
| `src/index.ts` | CLI (`analyze`, `import`, `projects`) |
| `src/config.ts` | โหลดค่าจาก `.env` |
| `src/projects.ts` | ทะเบียนโปรเจกต์ (อ่าน `projects/<id>.json`) |
| `src/ai.ts` | เรียก develyst-ai gateway + parse JSON |
| `src/git.ts` | diff 2 ref, อ่านไฟล์ที่ ref |
| `src/context.ts` | รวม requirement + base docs → ให้ AI สรุปบริบท |
| `src/changeRequest.ts` | โหลดเอกสาร requirement/CR (md/txt/pdf) |
| `src/analyze.ts` | orchestrator: วิเคราะห์รายไฟล์ + สรุปภาพรวม |
| `src/report.ts` | สร้างรายงาน markdown + HTML |
| `src/email.ts` | ส่งอีเมลผ่าน Microsoft Graph |

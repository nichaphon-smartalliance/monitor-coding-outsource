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
        ├─ อ่าน base docs (README/docs) → ให้ AI เข้าใจว่าโปรเจกต์ทำอะไร + ศัพท์เฉพาะ
        ├─ อ่าน request-change doc ของรอบนั้น (.md/.txt/.pdf)
        ▼
  AI วิเคราะห์ทีละไฟล์ → จัดกลุ่ม (ตามที่ขอ / งานหลัก / นอกเหนือ / refactor / config)
        │
        ▼
  รายงาน .md + สรุปภาพรวม → (เลือก) ส่งอีเมลผ่าน Microsoft Graph
```

AI เรียกผ่าน **develyst-ai gateway** (ต้องรันก่อน) ที่ `localhost:3009`
อีเมลส่งผ่าน **Microsoft Graph** (client-credentials)

## เตรียมก่อนใช้

1. ติดตั้ง dependency: `bun install`
2. คัดลอก `.env.example` เป็น `.env` แล้วเติมค่า (AI gateway URL, Microsoft Graph credentials, ผู้รับอีเมล)
3. รัน develyst-ai gateway ไว้ก่อน:
   ```
   cd C:\Users\Admin\develyst\develyst-ai
   bun run dev
   ```

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

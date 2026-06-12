// รวบรวม "base docs" ของโปรเจกต์ที่ ref หนึ่ง แล้วให้ AI สรุปเป็นบริบท
// เพื่อให้รอบวิเคราะห์ diff เข้าใจว่าโปรเจกต์ทำอะไร + ใช้คำศัพท์ให้ถูก

import { listFilesAtRef, readFileAtRef } from "./git.ts";
import { chat } from "./ai.ts";
import { config } from "./config.ts";
import type { LoadedDoc, ProjectContext } from "./types.ts";

const MAX_DOC_CHARS = 60000; // รวมทุก docs ไม่เกินเท่านี้ (กัน token บาน)
const PER_DOC_CHARS = 12000;

// ไฟล์ที่ถือว่าเป็น "เอกสารอธิบายโปรเจกต์" (ใช้เป็น fallback เมื่อไม่มี requirement doc)
// หมายเหตุ: ไม่อ่าน CLAUDE.md / package.json / build files เพราะเป็น guidance สำหรับ dev/AI
//          ไม่ใช่สเปกธุรกิจของโปรเจกต์
function isDocFile(path: string): boolean {
  const p = path.toLowerCase();
  const base = p.split("/").pop() ?? p;
  if (base === "claude.md") return false; // ห้ามใช้ CLAUDE.md เป็นแหล่งความเข้าใจโปรเจกต์
  if (base === "readme.md" || base === "readme") return true;
  if (p.startsWith("docs/") && (p.endsWith(".md") || p.endsWith(".txt"))) return true;
  if (p.startsWith("doc/") && (p.endsWith(".md") || p.endsWith(".txt"))) return true;
  // .md ที่ root (ความลึก 0) — ยกเว้น CLAUDE.md ที่ตัดไปแล้วข้างบน
  if (p.endsWith(".md") && !p.includes("/")) return true;
  return false;
}

export function collectDocs(repo: string, ref: string): { path: string; text: string }[] {
  const all = listFilesAtRef(repo, ref);
  const docs: { path: string; text: string }[] = [];
  let total = 0;
  for (const path of all) {
    if (!isDocFile(path)) continue;
    let text = readFileAtRef(repo, ref, path);
    if (!text.trim()) continue;
    if (text.length > PER_DOC_CHARS) text = text.slice(0, PER_DOC_CHARS) + "\n...[ตัด]...";
    if (total + text.length > MAX_DOC_CHARS) break;
    total += text.length;
    docs.push({ path, text });
  }
  return docs;
}

export async function buildProjectContext(
  repo: string,
  ref: string,
  requirement?: LoadedDoc,
): Promise<ProjectContext> {
  const hasRequirement = !!(requirement && requirement.text.trim());
  // ถ้ามี requirement doc → ใช้เป็น "แหล่งความเข้าใจหลัก" อย่างเดียว (ไม่ปนเอกสาร dev ใน repo)
  // ถ้าไม่มี → fallback ไปอ่าน README/docs ใน repo (แต่ไม่แตะ CLAUDE.md)
  const docs = hasRequirement
    ? [{ path: `[PROJECT REQUIREMENT] ${requirement!.path}`, text: requirement!.text.slice(0, 30000) }]
    : collectDocs(repo, ref);

  if (docs.length === 0) {
    return {
      overview: config.language === "th"
        ? "ไม่มี project requirement และไม่พบ README/docs — วิเคราะห์จากโค้ดที่เปลี่ยนล้วน ๆ (แนะนำให้เพิ่ม requirement doc เพื่อความแม่นยำ)"
        : "No project requirement and no README/docs found — analysing from code changes only.",
      glossary: "",
      sourceDocs: [],
    };
  }

  const docBlob = docs
    .map((d) => `===== FILE: ${d.path} =====\n${d.text}`)
    .join("\n\n");

  const langInstruction = config.language === "th"
    ? "ตอบเป็นภาษาไทย"
    : "Answer in English";

  const system = `คุณกำลังศึกษาโปรเจกต์จาก "project requirement" เพื่อเตรียมรีวิวงานที่ vendor ส่งมอบ
หน้าที่: อ่าน requirement แล้วสรุปความเข้าใจ "เชิงธุรกิจ/ฟีเจอร์" (มองจากมุมผู้ใช้/PM ไม่ใช่มุมโค้ด) ${langInstruction}
ตอบเป็น JSON เท่านั้น รูปแบบ:
{
  "overview": "สรุปว่าโปรเจกต์นี้คืออะไร มีไว้ทำอะไร ผู้ใช้ทำอะไรได้บ้าง ฟีเจอร์/ความสามารถหลักมีอะไร (ย่อ 1-2 ย่อหน้า ภาษาคนทั่วไป)",
  "glossary": "คำศัพท์/ชื่อเฉพาะเชิงโดเมนของโปรเจกต์ (เช่น ชื่อฟีเจอร์ ชื่อโมดูลเชิงธุรกิจ) ที่ควรใช้ให้ถูกเวลาอธิบาย — bullet สั้น ๆ ไม่ต้องลงรายละเอียดเทคนิค"
}`;

  const user = `เอกสารของโปรเจกต์:\n\n${docBlob}`;

  try {
    const raw = await chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { maxTokens: 4000, spec: config.ai.contextModel },
    );
    const { extractJSON } = await import("./ai.ts");
    const parsed = extractJSON<{ overview: string; glossary: string }>(raw);
    return {
      overview: parsed?.overview ?? raw.slice(0, 2000),
      glossary: parsed?.glossary ?? "",
      sourceDocs: docs.map((d) => d.path),
    };
  } catch (err: any) {
    return {
      overview: `(สรุปบริบทไม่สำเร็จ: ${err?.message ?? err}) — อ่าน docs ได้: ${docs.map((d) => d.path).join(", ")}`,
      glossary: "",
      sourceDocs: docs.map((d) => d.path),
    };
  }
}

// รวบรวม "base docs" ของโปรเจกต์ที่ ref หนึ่ง แล้วให้ AI สรุปเป็นบริบท
// เพื่อให้รอบวิเคราะห์ diff เข้าใจว่าโปรเจกต์ทำอะไร + ใช้คำศัพท์ให้ถูก

import { listFilesAtRef, readFileAtRef } from "./git.ts";
import { chat } from "./ai.ts";
import { config } from "./config.ts";
import type { ProjectContext } from "./types.ts";

const MAX_DOC_CHARS = 60000; // รวมทุก docs ไม่เกินเท่านี้ (กัน token บาน)
const PER_DOC_CHARS = 12000;

// ไฟล์ที่ถือว่าเป็น "เอกสารอธิบายโปรเจกต์"
function isDocFile(path: string): boolean {
  const p = path.toLowerCase();
  const base = p.split("/").pop() ?? p;
  if (base === "readme.md" || base === "readme" || base === "claude.md") return true;
  if (base === "package.json" || base === "pom.xml" || base === "build.gradle") return true;
  if (p.startsWith("docs/") && (p.endsWith(".md") || p.endsWith(".txt"))) return true;
  if (p.startsWith("doc/") && (p.endsWith(".md") || p.endsWith(".txt"))) return true;
  // .md ที่ root (ความลึก 0)
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

export async function buildProjectContext(repo: string, ref: string): Promise<ProjectContext> {
  const docs = collectDocs(repo, ref);

  if (docs.length === 0) {
    return {
      overview: config.language === "th"
        ? "ไม่พบเอกสารอธิบายโปรเจกต์ (README/docs) ใน ref นี้ — วิเคราะห์จากโค้ดที่เปลี่ยนล้วน ๆ"
        : "No project docs (README/docs) found at this ref — analysing from code changes only.",
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

  const system = `คุณเป็น senior software architect ที่กำลังศึกษาโปรเจกต์เพื่อเตรียมรีวิวโค้ดที่ vendor ส่งมอบ
หน้าที่: อ่านเอกสารโปรเจกต์ที่ให้มา แล้วสรุปความเข้าใจ ${langInstruction}
ตอบเป็น JSON เท่านั้น รูปแบบ:
{
  "overview": "สรุปว่าโปรเจกต์นี้คืออะไร ทำงานอะไร มีโมดูล/ฟีเจอร์หลักอะไร สถาปัตยกรรม/เทคโนโลยีที่ใช้ (ย่อ 1-2 ย่อหน้า)",
  "glossary": "คำศัพท์/ชื่อเฉพาะ/โดเมนของโปรเจกต์ที่ควรใช้ให้ถูกเวลาอธิบายการเปลี่ยนแปลง (bullet สั้น ๆ)"
}`;

  const user = `เอกสารของโปรเจกต์:\n\n${docBlob}`;

  try {
    const raw = await chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { maxTokens: 2048, spec: config.ai.contextModel },
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

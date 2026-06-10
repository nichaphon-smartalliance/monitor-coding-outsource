// orchestrator: รวมบริบทโปรเจกต์ + request-change + diff แล้วให้ AI วิเคราะห์ทีละไฟล์
// จากนั้นสรุปภาพรวม (executive summary)

import { chatJSON, chat } from "./ai.ts";
import { config } from "./config.ts";
import { buildProjectContext } from "./context.ts";
import { diffFiles, commitLog } from "./git.ts";
import type {
  AnalysisReport,
  ChangeClass,
  ChangedFile,
  ChangeRequestDoc,
  FileAnalysis,
  ProjectContext,
} from "./types.ts";

const CONCURRENCY = 3;

interface AIFileResult {
  summary: string;
  classification: ChangeClass;
  matchedRequest?: string;
  confidence: "high" | "medium" | "low";
  risk: "low" | "medium" | "high";
  notes?: string;
}

function fileSystemPrompt(ctx: ProjectContext, cr?: ChangeRequestDoc): string {
  const lang = config.language === "th" ? "ตอบเป็นภาษาไทย" : "Answer in English";
  const crBlock = cr
    ? `\n\n# request-change ที่ลูกค้าขอไว้สำหรับรอบนี้ (ใช้จับคู่ว่าการเปลี่ยนแปลงตรงกับที่ขอไหม):\n${cr.text.slice(0, 8000)}`
    : "\n\n# หมายเหตุ: รอบนี้ไม่มีเอกสาร request-change แนบมา";

  return `คุณเป็น senior code reviewer กำลังตรวจโค้ดที่ vendor (outsource) ส่งมอบรายเดือน
${lang} และใช้คำศัพท์ให้ตรงกับโดเมนของโปรเจกต์

# บริบทโปรเจกต์
${ctx.overview}

# คำศัพท์/โดเมนเฉพาะ
${ctx.glossary || "(ไม่มี)"}
${crBlock}

# งานของคุณ
ดู diff ของไฟล์ 1 ไฟล์ แล้ววิเคราะห์ว่ามีการเปลี่ยนอะไร อธิบายให้คนที่ไม่ได้อ่านโค้ดเข้าใจได้
จัดกลุ่มการเปลี่ยนแปลง:
- "requested-change" = ตรงกับ request-change ที่ลูกค้าขอ (ระบุข้อที่ตรงใน matchedRequest)
- "main-requirement" = งานหลักตาม requirement ของโปรเจกต์ (ไม่ได้อยู่ใน request-change รอบนี้แต่สมเหตุสมผล)
- "refactor" = ปรับโครงสร้าง/จัดระเบียบ ไม่เปลี่ยนพฤติกรรม
- "config-or-build" = config, dependency, build script
- "unexpected" = เปลี่ยนนอกเหนือสิ่งที่ขอและดูไม่เกี่ยว ควรตรวจสอบ
- "unknown" = ข้อมูลไม่พอจะตัดสิน

ตอบเป็น JSON เท่านั้น:
{
  "summary": "อธิบายสั้น กระชับ ว่าไฟล์นี้เปลี่ยนอะไร (1-3 ประโยค)",
  "classification": "requested-change | main-requirement | refactor | config-or-build | unexpected | unknown",
  "matchedRequest": "ข้อความ/หัวข้อ request-change ที่ตรง (เว้นว่างถ้าไม่ตรง)",
  "confidence": "high | medium | low",
  "risk": "low | medium | high",
  "notes": "ข้อสังเกตเพิ่ม เช่น breaking change / ผลกระทบด้านความปลอดภัย / ควรรีวิวพิเศษ (เว้นว่างได้)"
}`;
}

function fileUserPrompt(f: ChangedFile): string {
  if (f.binary) {
    return `ไฟล์ binary: ${f.path} (สถานะ: ${f.status}) — ไม่มี text diff`;
  }
  const renameNote = f.oldPath ? ` (เปลี่ยนชื่อจาก ${f.oldPath})` : "";
  return `ไฟล์: ${f.path}${renameNote}
สถานะ: ${f.status} (+${f.additions} -${f.deletions})${f.truncated ? " [diff ถูกตัดบางส่วน]" : ""}

\`\`\`diff
${f.patch || "(ไม่มี patch)"}
\`\`\``;
}

async function analyzeFile(f: ChangedFile, ctx: ProjectContext, cr?: ChangeRequestDoc): Promise<FileAnalysis> {
  if (f.binary) {
    return {
      path: f.path,
      status: f.status,
      summary: "ไฟล์ binary เปลี่ยนแปลง (ไม่วิเคราะห์เนื้อหา)",
      classification: "unknown",
      confidence: "low",
      risk: "low",
    };
  }

  try {
    const { data, raw } = await chatJSON<AIFileResult>(
      [
        { role: "system", content: fileSystemPrompt(ctx, cr) },
        { role: "user", content: fileUserPrompt(f) },
      ],
      { maxTokens: 1200 },
    );

    if (!data) {
      return {
        path: f.path,
        status: f.status,
        summary: raw.slice(0, 400) || "วิเคราะห์ไม่สำเร็จ",
        classification: "unknown",
        confidence: "low",
        risk: "low",
        raw,
      };
    }

    return {
      path: f.path,
      status: f.status,
      summary: data.summary ?? "",
      classification: normalizeClass(data.classification),
      matchedRequest: data.matchedRequest?.trim() || undefined,
      confidence: normalizeLevel(data.confidence, ["high", "medium", "low"], "low") as any,
      risk: normalizeLevel(data.risk, ["low", "medium", "high"], "low") as any,
      notes: data.notes?.trim() || undefined,
    };
  } catch (err: any) {
    return {
      path: f.path,
      status: f.status,
      summary: `วิเคราะห์ไม่สำเร็จ: ${err?.message ?? err}`,
      classification: "unknown",
      confidence: "low",
      risk: "low",
    };
  }
}

function normalizeClass(c: string | undefined): ChangeClass {
  const valid: ChangeClass[] = [
    "requested-change", "main-requirement", "refactor",
    "config-or-build", "unexpected", "unknown",
  ];
  return valid.includes(c as ChangeClass) ? (c as ChangeClass) : "unknown";
}
function normalizeLevel(v: string | undefined, allowed: string[], fallback: string): string {
  return allowed.includes((v ?? "").toLowerCase()) ? (v as string).toLowerCase() : fallback;
}

// จำกัด concurrency เวลายิง AI หลายไฟล์
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface AnalyzeOptions {
  repo: string;
  baseRef: string;
  headRef: string;
  changeRequest?: ChangeRequestDoc;
  onProgress?: (msg: string) => void;
}

export async function runAnalysis(opts: AnalyzeOptions): Promise<AnalysisReport> {
  const { repo, baseRef, headRef, changeRequest, onProgress } = opts;
  const log = onProgress ?? (() => {});

  log("📖 อ่าน base docs และสรุปบริบทโปรเจกต์...");
  const projectContext = await buildProjectContext(repo, headRef);

  log("🔍 ดึง diff ระหว่าง branch...");
  const files = diffFiles(repo, baseRef, headRef);
  log(`   พบ ${files.length} ไฟล์ที่เปลี่ยน`);

  log("🤖 วิเคราะห์การเปลี่ยนแปลงทีละไฟล์...");
  let done = 0;
  const analyses = await mapLimit(files, CONCURRENCY, async (f) => {
    const r = await analyzeFile(f, projectContext, changeRequest);
    done++;
    log(`   [${done}/${files.length}] ${f.path}`);
    return r;
  });

  const stats = {
    totalFiles: analyses.length,
    requested: analyses.filter((a) => a.classification === "requested-change").length,
    mainRequirement: analyses.filter((a) => a.classification === "main-requirement").length,
    unexpected: analyses.filter((a) => a.classification === "unexpected").length,
    highRisk: analyses.filter((a) => a.risk === "high").length,
  };

  log("📝 สรุปภาพรวม (executive summary)...");
  const executiveSummary = await buildExecutiveSummary(analyses, projectContext, changeRequest, { baseRef, headRef });

  return {
    repo,
    baseRef,
    headRef,
    generatedAt: new Date().toISOString(),
    projectContext,
    changeRequestPath: changeRequest?.path,
    files: analyses,
    executiveSummary,
    stats,
  };
}

async function buildExecutiveSummary(
  files: FileAnalysis[],
  ctx: ProjectContext,
  cr: ChangeRequestDoc | undefined,
  refs: { baseRef: string; headRef: string },
): Promise<string> {
  const lang = config.language === "th" ? "ภาษาไทย" : "English";
  const compact = files.map((f) => ({
    path: f.path,
    status: f.status,
    class: f.classification,
    matched: f.matchedRequest,
    risk: f.risk,
    summary: f.summary,
  }));

  const system = `คุณเป็น tech lead กำลังเขียนสรุปผลการตรวจโค้ดที่ vendor ส่งมอบ เพื่อรายงานหัวหน้า/ลูกค้าทางอีเมล
เขียนเป็น ${lang} กระชับ มืออาชีพ ใช้คำศัพท์ตรงกับโดเมนของโปรเจกต์

บริบทโปรเจกต์: ${ctx.overview}
คำศัพท์: ${ctx.glossary || "(ไม่มี)"}
${cr ? `request-change รอบนี้:\n${cr.text.slice(0, 4000)}` : "รอบนี้ไม่มี request-change แนบมา"}

เขียนสรุปแบบ markdown สั้น ๆ ครอบคลุม:
1. ภาพรวมว่ารอบ ${refs.baseRef} → ${refs.headRef} มีการเปลี่ยนอะไรหลัก ๆ
2. request-change ที่ขอไป ถูกทำครบไหม (ถ้ามี) อันไหนเจอ/ไม่เจอ
3. การเปลี่ยนแปลงที่อยู่นอกเหนือ request-change (งานหลัก / unexpected)
4. จุดที่ควรรีวิว/ความเสี่ยง (ถ้ามี)
ห้ามแต่งข้อมูลเกินจากที่ให้มา`;

  try {
    return await chat(
      [
        { role: "system", content: system },
        { role: "user", content: "ผลวิเคราะห์รายไฟล์ (JSON):\n" + JSON.stringify(compact, null, 2) },
      ],
      { maxTokens: 2048 },
    );
  } catch (err: any) {
    return `(สร้างสรุปภาพรวมไม่สำเร็จ: ${err?.message ?? err})`;
  }
}

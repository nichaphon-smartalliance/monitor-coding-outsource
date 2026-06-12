// orchestrator: รวมบริบทโปรเจกต์ + request-change + diff แล้วให้ AI วิเคราะห์ทีละไฟล์
// จากนั้นสรุปภาพรวม (executive summary)

import { chatJSON, chat, specLabel } from "./ai.ts";
import { config } from "./config.ts";
import { buildProjectContext } from "./context.ts";
import { diffFiles, commitLog } from "./git.ts";
import type {
  AnalysisReport,
  ChangeClass,
  ChangedFile,
  ChangeRequestDoc,
  ChatMessage,
  FileAnalysis,
  LoadedDoc,
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
    ? `\n\n# Backlog ของ request-change ที่เคยขอไว้ (สะสม ไม่ผูกเดือน — รอบนี้อาจทำ CR เก่าที่ขอไว้นานแล้วก็ได้):\n${cr.text.slice(0, 8000)}`
    : "\n\n# หมายเหตุ: ไม่มีเอกสาร request-change";

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
- "requested-change" = ตรงกับ request-change ใน backlog (ระบุข้อที่ตรงใน matchedRequest) ไม่ว่าจะขอไว้นานแค่ไหน
- "main-requirement" = งานหลักตาม project requirement ตั้งต้น (ไม่ได้อยู่ใน CR backlog แต่สอดคล้องสเปก)
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

// prompt สำหรับรอบ "ตรวจทาน/แก้" ของโมเดลถัดไปใน chain
function refineSystemPrompt(ctx: ProjectContext, cr?: ChangeRequestDoc): string {
  return fileSystemPrompt(ctx, cr) + `

# โหมดตรวจทาน
ด้านล่างมีผลวิเคราะห์ของโมเดลก่อนหน้า (draft) ให้คุณตรวจทานเทียบกับ diff จริงและ request-change:
- ถ้าถูกต้องแล้ว คงไว้/ปรับให้คมขึ้น
- ถ้าจัดประเภทผิด, ประเมินความเสี่ยงพลาด, จับคู่ CR ผิด หรืออธิบายไม่ตรงโค้ด ให้แก้
- ระวัง false negative ด้านความปลอดภัย (เช่น ส่งข้อมูลออกนอกระบบ, hardcoded secret, เปลี่ยนสิทธิ์)
ตอบกลับเป็น JSON รูปแบบเดิมเท่านั้น (ฉบับที่แก้แล้ว)`;
}

function mapResult(f: ChangedFile, data: AIFileResult, modelsUsed: string[], raw?: string): FileAnalysis {
  return {
    path: f.path,
    status: f.status,
    summary: data.summary ?? "",
    classification: normalizeClass(data.classification),
    matchedRequest: data.matchedRequest?.trim() || undefined,
    confidence: normalizeLevel(data.confidence, ["high", "medium", "low"], "low") as any,
    risk: normalizeLevel(data.risk, ["low", "medium", "high"], "low") as any,
    notes: data.notes?.trim() || undefined,
    modelsUsed,
    raw,
  };
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

  const chain = config.ai.analyzeChain.length ? config.ai.analyzeChain : [{}];
  let current: AIFileResult | null = null;
  let lastRaw = "";
  const modelsUsed: string[] = [];

  for (let i = 0; i < chain.length; i++) {
    const spec = chain[i];
    const isDraft = i === 0;
    const messages: ChatMessage[] = isDraft
      ? [
          { role: "system" as const, content: fileSystemPrompt(ctx, cr) },
          { role: "user" as const, content: fileUserPrompt(f) },
        ]
      : [
          { role: "system" as const, content: refineSystemPrompt(ctx, cr) },
          { role: "user" as const, content:
            fileUserPrompt(f) +
            `\n\n# ผลวิเคราะห์ของโมเดลก่อนหน้า (ตรวจทาน):\n${JSON.stringify(current, null, 2)}` },
        ];

    try {
      const { data, raw } = await chatJSON<AIFileResult>(messages, { maxTokens: 1200, spec });
      lastRaw = raw;
      modelsUsed.push(specLabel(spec));
      if (data) current = data; // ถ้ารอบนี้ parse ไม่ได้ คงผลก่อนหน้าไว้
    } catch {
      // โมเดลตัวนี้ล่ม → ข้ามไปใช้ผลที่มี/รอบถัดไป
      modelsUsed.push(specLabel(spec) + "(ล้มเหลว)");
    }
  }

  if (!current) {
    return {
      path: f.path,
      status: f.status,
      summary: lastRaw.slice(0, 400) || "วิเคราะห์ไม่สำเร็จ",
      classification: "unknown",
      confidence: "low",
      risk: "low",
      modelsUsed,
      raw: lastRaw,
    };
  }
  return mapResult(f, current, modelsUsed);
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
  projectName?: string;
  requirement?: LoadedDoc;      // สเปกตั้งต้นของโปรเจกต์
  changeRequest?: ChangeRequestDoc; // backlog ของ CR
  onProgress?: (msg: string) => void;
}

export async function runAnalysis(opts: AnalyzeOptions): Promise<AnalysisReport> {
  const { repo, baseRef, headRef, projectName, requirement, changeRequest, onProgress } = opts;
  const log = onProgress ?? (() => {});

  log("📖 อ่าน requirement + base docs และสรุปบริบทโปรเจกต์...");
  const projectContext = await buildProjectContext(repo, headRef, requirement);

  log("🔍 ดึง diff ระหว่าง branch...");
  const files = diffFiles(repo, baseRef, headRef);
  log(`   พบ ${files.length} ไฟล์ที่เปลี่ยน`);

  const chainLabels = (config.ai.analyzeChain.length ? config.ai.analyzeChain : [{}]).map(specLabel);
  log(`🤖 วิเคราะห์การเปลี่ยนแปลงทีละไฟล์ (refine chain: ${chainLabels.join(" → ")})...`);
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

  log(`📝 สรุปภาพรวม + เรียบเรียงอีเมล (writer: ${specLabel(config.ai.writerModel)})...`);
  const executiveSummary = await buildExecutiveSummary(analyses, projectContext, changeRequest, { baseRef, headRef });

  return {
    repo,
    baseRef,
    headRef,
    generatedAt: new Date().toISOString(),
    projectName,
    projectContext,
    requirementPath: requirement?.path,
    changeRequestPath: changeRequest?.path,
    files: analyses,
    executiveSummary,
    pipeline: {
      contextModel: specLabel(config.ai.contextModel),
      analyzeChain: chainLabels,
      writerModel: specLabel(config.ai.writerModel),
    },
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
  // ป้อนเฉพาะข้อมูลที่จำเป็นต่อการสรุป — ไม่ส่ง path ไฟล์เข้าไป (กันหลุดลงสรุป PM)
  const compact = files.map((f) => ({
    class: f.classification,
    matchedCR: f.matchedRequest,
    risk: f.risk,
    detail: f.summary,
  }));

  const system = `คุณเป็น Project Manager กำลังเขียน "อีเมลรายงานความคืบหน้า" ถึงหัวหน้า/ลูกค้า เกี่ยวกับงานที่ vendor ส่งมอบรอบนี้
ผู้อ่านเข้าใจ "ตัวโปรเจกต์/ธุรกิจ" แต่ "ไม่อ่านโค้ด" — เขียนเป็น ${lang}

ความเข้าใจโปรเจกต์ (จาก requirement):
${ctx.overview}
ศัพท์เชิงธุรกิจของโปรเจกต์: ${ctx.glossary || "(ไม่มี)"}
${cr ? `รายการ request-change ที่เคยขอ (backlog):\n${cr.text.slice(0, 4000)}` : "ไม่มีรายการ request-change"}

กฎการเขียน (สำคัญมาก):
- ใช้ "ภาษาธุรกิจ/ภาษาคนทั่วไป" เล่าเป็น "ความสามารถ/ฟีเจอร์ที่เปลี่ยนไป" ไม่ใช่รายละเอียดโค้ด
- ห้ามใส่: ชื่อไฟล์, path, ชื่อฟังก์ชัน/ตัวแปร/คลาส, ชื่อไลบรารี/เฟรมเวิร์ก/เทคนิค, โค้ด, อีโมจิ
- ถ้าข้อมูลที่ได้รับมีศัพท์เทคนิค ให้ "แปล" เป็นผลลัพธ์ที่ผู้ใช้/ธุรกิจสัมผัสได้ (เช่น แทนที่จะบอกชื่อไลบรารี ให้บอกว่า "ปรับหน้าตาเว็บให้เป็นมาตรฐานเดียวกันทั้งระบบ")
- กระชับ ตรงประเด็น เป็นมืออาชีพ ห้ามแต่งข้อมูลเกินจากที่ให้มา

เขียนเป็นเนื้อความอีเมล (ขึ้นต้น "เรียน ..." ลงท้ายสุภาพ) ครอบคลุมหัวข้อ:
1. ภาพรวม: รอบส่งมอบนี้ปรับปรุง/เพิ่มความสามารถอะไรให้ระบบ (เชิงผู้ใช้)
2. สถานะสิ่งที่เราขอ (request-change): อันไหนทำเสร็จแล้ว อันไหนยังไม่ได้ทำ — เล่าเป็นภาษาคน
3. งานที่ vendor ทำเพิ่มนอกเหนือจากที่เราขอ (ถ้ามี) และผลกระทบ
4. จุดที่ควรตรวจรับ/ต้องระวังเป็นพิเศษ (ถ้ามี) — อธิบายว่าทำไม เป็นภาษาคน`;

  try {
    return await chat(
      [
        { role: "system", content: system },
        { role: "user", content: "ผลวิเคราะห์รายไฟล์ (JSON):\n" + JSON.stringify(compact, null, 2) },
      ],
      // เผื่องบให้เยอะ: บาง model (เช่น gemini flash) ใช้ token ไปกับ thinking ก่อนเขียนจริง
      { maxTokens: 6000, spec: config.ai.writerModel },
    );
  } catch (err: any) {
    return `(สร้างสรุปภาพรวมไม่สำเร็จ: ${err?.message ?? err})`;
  }
}

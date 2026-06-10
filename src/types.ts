// ===== โครงสร้างข้อมูลกลางของเครื่องมือ =====

// message ที่ส่งให้ AI gateway (ตรงกับ develyst-ai)
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// response จาก develyst-ai: { success, data: AIResponse }
export interface AIResponse {
  provider: string;
  model: string;
  content: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  latency_ms: number;
}

// สถานะของไฟล์ใน diff
export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "other";

// ไฟล์ 1 ไฟล์ที่เปลี่ยนไประหว่าง 2 ref
export interface ChangedFile {
  path: string;
  oldPath?: string; // กรณี renamed
  status: FileStatus;
  additions: number;
  deletions: number;
  patch: string;        // เนื้อ diff (อาจถูก truncate)
  truncated: boolean;   // true ถ้า patch ถูกตัดเพราะยาวเกิน
  binary: boolean;
}

// ผลวิเคราะห์ของไฟล์ 1 ไฟล์ (มาจาก AI)
export interface FileAnalysis {
  path: string;
  status: FileStatus;
  summary: string;                 // อธิบายว่าทำอะไรเปลี่ยน (ภาษาคน)
  classification: ChangeClass;     // จัดกลุ่มว่าเป็นอะไร
  matchedRequest?: string;         // ถ้าเป็น CR: ตรงกับข้อไหนใน request-change doc
  confidence: "high" | "medium" | "low";
  risk: "low" | "medium" | "high"; // ความเสี่ยง/ควรรีวิวเป็นพิเศษ
  notes?: string;                  // ข้อสังเกตเพิ่ม เช่น breaking change, security
  raw?: string;                    // เผื่อ parse JSON ไม่ได้ เก็บข้อความดิบไว้
  modelsUsed?: string[];           // โมเดลที่ร่วมคิดไฟล์นี้ (refine chain)
}

export type ChangeClass =
  | "requested-change"   // ตรงกับ request-change ที่เราขอไป
  | "main-requirement"   // งานหลักตาม project requirement
  | "refactor"           // ปรับโครงสร้าง/ไม่เปลี่ยน behavior
  | "config-or-build"    // config, dependency, build
  | "unexpected"         // เปลี่ยนนอกเหนือที่ขอ ควรตรวจสอบ
  | "unknown";

// บริบทของโปรเจกต์ที่ AI สรุปจาก base docs
export interface ProjectContext {
  overview: string;   // สรุปว่าโปรเจกต์ทำอะไร
  glossary: string;   // คำศัพท์/โดเมนเฉพาะของโปรเจกต์
  sourceDocs: string[]; // รายชื่อไฟล์ docs ที่อ่าน
}

// เอกสารทั่วไปที่โหลดเป็น text (requirement / change-request)
export interface LoadedDoc {
  path: string;
  text: string;       // เนื้อหาดิบ (md/txt/pdf->text)
}
// ใช้ชื่อเดิมต่อได้ (alias)
export type ChangeRequestDoc = LoadedDoc;

// ทะเบียนโปรเจกต์ 1 ตัว (ไฟล์ projects/<id>.json)
export interface ProjectConfig {
  id: string;                 // มาจากชื่อไฟล์ เช่น shopx
  name: string;               // ชื่อแสดงผล
  repo: string;               // path repo ที่เก็บโค้ดส่งมอบ (relative ต่อ tool root หรือ absolute)
  requirementDoc?: string;    // สเปกตั้งต้นของโปรเจกต์
  changeRequests?: string;    // backlog ของ request-change (ไม่ผูกเดือน)
  baseBranch?: string;        // branch ตั้งต้น (ถ้าไม่ระบุ --base)
  emailTo?: string[];         // ผู้รับเมลเฉพาะโปรเจกต์นี้ (override .env)
}

// รายงานรวมทั้งหมด
export interface AnalysisReport {
  repo: string;
  baseRef: string;
  headRef: string;
  generatedAt: string;
  projectName?: string;
  projectContext: ProjectContext;
  requirementPath?: string;
  changeRequestPath?: string;
  files: FileAnalysis[];
  executiveSummary: string; // สรุปผู้บริหาร (ภาษาคน)
  pipeline: {               // โมเดลที่ใช้ในแต่ละสเตจ (เพื่อความโปร่งใส)
    contextModel: string;
    analyzeChain: string[];
    writerModel: string;
  };
  stats: {
    totalFiles: number;
    requested: number;
    mainRequirement: number;
    unexpected: number;
    highRisk: number;
  };
}

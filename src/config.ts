// โหลดค่าตั้งจาก environment (Bun โหลด .env ให้อัตโนมัติ)

function str(key: string, fallback = ""): string {
  return (process.env[key] ?? fallback).trim();
}
function num(key: string, fallback: number): number {
  const v = process.env[key];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function bool(key: string, fallback = false): boolean {
  const v = (process.env[key] ?? "").trim().toLowerCase();
  if (v === "") return fallback;
  return v === "true" || v === "1" || v === "yes";
}

// "provider" หรือ "provider:model" -> { provider, model }
export interface ModelSpec {
  provider?: string;
  model?: string;
}
export function parseSpec(s: string): ModelSpec {
  const t = s.trim();
  if (!t) return {};
  const [p, ...rest] = t.split(":");
  const model = rest.join(":").trim();
  return { provider: p.trim() || undefined, model: model || undefined };
}
function parseChain(key: string, fallback: string): ModelSpec[] {
  const raw = str(key) || fallback;
  return raw.split(",").map((s) => parseSpec(s)).filter((s) => s.provider || s.model);
}

export const config = {
  ai: {
    gatewayUrl: str("AI_GATEWAY_URL", "https://ai.develyst.online").replace(/\/$/, ""),
    provider: str("AI_PROVIDER") || undefined, // undefined = ใช้ fallback chain ของ gateway
    model: str("AI_MODEL") || undefined,
    maxTokens: num("AI_MAX_TOKENS", 4096),
    temperature: num("AI_TEMPERATURE", 0.2),
    timeout: num("AI_TIMEOUT", 120000),
    // ===== pipeline หลายสเตจ =====
    // Stage 1: เข้าใจ docs (model เล็ก)
    contextModel: parseSpec(str("AI_CONTEXT_MODEL", "deepseek:deepseek-chat")),
    // Stage 2: วิเคราะห์โค้ดรายไฟล์ แบบ refine chain (ส่งต่อให้กันตรวจทาน)
    analyzeChain: parseChain("AI_ANALYZE_CHAIN", "deepseek:deepseek-chat,xai:grok-3,openai:gpt-4o-mini"),
    // Stage 3: เขียนอีเมล/สรุปภาพรวม (model ใหญ่)
    writerModel: parseSpec(str("AI_WRITER_MODEL", "openai:gpt-4o")),
  },
  repo: str("TARGET_REPO") || process.cwd(),
  language: (str("REPORT_LANGUAGE", "th").toLowerCase() === "en" ? "en" : "th") as "th" | "en",
  email: {
    clientId: str("MS_CLIENT_ID"),
    clientSecret: str("MS_CLIENT_SECRET"),
    tenantId: str("MS_TENANT_ID"),
    sender: str("MS_SENDER_EMAIL"),
    to: str("EMAIL_TO").split(",").map((s) => s.trim()).filter(Boolean),
    cc: str("EMAIL_CC").split(",").map((s) => s.trim()).filter(Boolean),
    sendEnabled: bool("EMAIL_SEND_ENABLED", false),
  },
} as const;

export function assertEmailConfig(): string | null {
  const e = config.email;
  if (!e.clientId || !e.clientSecret || !e.tenantId) {
    return "ขาด MS_CLIENT_ID / MS_CLIENT_SECRET / MS_TENANT_ID ใน .env";
  }
  if (!e.sender) return "ขาด MS_SENDER_EMAIL ใน .env";
  if (e.to.length === 0) return "ขาด EMAIL_TO (ผู้รับ) ใน .env";
  return null;
}

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

export const config = {
  ai: {
    gatewayUrl: str("AI_GATEWAY_URL", "http://localhost:3009").replace(/\/$/, ""),
    provider: str("AI_PROVIDER") || undefined, // undefined = ใช้ fallback chain
    model: str("AI_MODEL") || undefined,
    maxTokens: num("AI_MAX_TOKENS", 4096),
    temperature: num("AI_TEMPERATURE", 0.2),
    timeout: num("AI_TIMEOUT", 120000),
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

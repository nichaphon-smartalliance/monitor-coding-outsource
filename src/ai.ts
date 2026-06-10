// client เรียก develyst-ai gateway

import { config } from "./config.ts";
import type { AIResponse, ChatMessage } from "./types.ts";

// เช็คว่า gateway ออนไลน์ไหม (GET /)
export async function checkGateway(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(config.ai.gatewayUrl + "/", {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const j: any = await res.json().catch(() => ({}));
    return { ok: true, detail: j?.name ?? "online" };
  } catch (err: any) {
    return { ok: false, detail: err?.message ?? "unreachable" };
  }
}

// เรียก AI 1 ครั้ง (มี retry เล็กน้อยกัน network สะดุด)
export async function chat(messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<string> {
  const body: Record<string, unknown> = {
    messages,
    temperature: config.ai.temperature,
    max_tokens: opts?.maxTokens ?? config.ai.maxTokens,
    timeout: config.ai.timeout,
  };
  // ถ้าระบุ provider/model เจาะจง ค่อยใส่ ไม่งั้นปล่อยให้ gateway fallback
  if (config.ai.provider) body.provider = config.ai.provider;
  if (config.ai.model) body.model = config.ai.model;

  let lastErr: Error = new Error("AI call failed");
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(config.ai.gatewayUrl + "/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.ai.timeout + 5000),
      });
      const json: any = await res.json();
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      const data: AIResponse = json.data;
      return data?.content ?? "";
    } catch (err: any) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

// ขอให้ AI ตอบเป็น JSON แล้ว parse ให้ (ทนต่อ code fence / ข้อความเกิน)
export async function chatJSON<T>(messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<{ data: T | null; raw: string }> {
  const raw = await chat(messages, opts);
  const parsed = extractJSON<T>(raw);
  return { data: parsed, raw };
}

export function extractJSON<T>(text: string): T | null {
  if (!text) return null;
  // ลอก ```json ... ``` ออกถ้ามี
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // หา object/array ก้อนแรก-ก้อนสุดท้าย
  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  let start = -1;
  if (firstObj === -1) start = firstArr;
  else if (firstArr === -1) start = firstObj;
  else start = Math.min(firstObj, firstArr);
  if (start === -1) return null;
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  const end = s.lastIndexOf(close);
  if (end <= start) return null;
  const candidate = s.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

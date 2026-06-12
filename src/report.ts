// แปลง AnalysisReport เป็น markdown (เก็บไฟล์) และ HTML (เนื้ออีเมล)

import type { AnalysisReport, ChangeClass, FileAnalysis } from "./types.ts";

const CLASS_LABEL: Record<ChangeClass, string> = {
  "requested-change": "✅ ตามที่ขอ (CR)",
  "main-requirement": "📦 งานหลัก",
  "refactor": "🔧 ปรับโครงสร้าง",
  "config-or-build": "⚙️ config/build",
  "unexpected": "⚠️ นอกเหนือที่ขอ",
  "unknown": "❓ ไม่แน่ใจ",
};

const RISK_LABEL: Record<string, string> = {
  high: "🔴 สูง",
  medium: "🟡 กลาง",
  low: "🟢 ต่ำ",
};

export function reportToMarkdown(r: AnalysisReport): string {
  const lines: string[] = [];
  lines.push(`# รายงานตรวจโค้ด outsource${r.projectName ? ` — ${r.projectName}` : ""}`);
  lines.push("");
  lines.push(`- **Repo:** ${r.repo}`);
  lines.push(`- **เทียบ:** \`${r.baseRef}\` → \`${r.headRef}\``);
  lines.push(`- **สร้างเมื่อ:** ${r.generatedAt}`);
  if (r.requirementPath) lines.push(`- **project requirement:** ${r.requirementPath}`);
  if (r.changeRequestPath) lines.push(`- **request-change backlog:** ${r.changeRequestPath}`);
  if (r.projectContext.sourceDocs.length) {
    lines.push(`- **base docs ที่อ่าน:** ${r.projectContext.sourceDocs.join(", ")}`);
  }
  lines.push("");

  lines.push(`## สรุปจำนวน`);
  lines.push(`| ไฟล์ทั้งหมด | ตามที่ขอ | งานหลัก | นอกเหนือที่ขอ | ความเสี่ยงสูง |`);
  lines.push(`|---:|---:|---:|---:|---:|`);
  lines.push(`| ${r.stats.totalFiles} | ${r.stats.requested} | ${r.stats.mainRequirement} | ${r.stats.unexpected} | ${r.stats.highRisk} |`);
  lines.push("");

  lines.push(`## สรุปภาพรวม`);
  lines.push(r.executiveSummary.trim());
  lines.push("");

  lines.push(`## รายละเอียดรายไฟล์`);
  lines.push("");
  lines.push(`| ไฟล์ | สถานะ | ประเภท | ความเสี่ยง | สรุป |`);
  lines.push(`|---|---|---|---|---|`);
  for (const f of r.files) {
    lines.push(
      `| \`${f.path}\` | ${f.status} | ${CLASS_LABEL[f.classification]} | ${RISK_LABEL[f.risk] ?? f.risk} | ${escapeCell(f.summary)} |`,
    );
  }
  lines.push("");

  // รายละเอียดเชิงลึกเฉพาะไฟล์ที่มี note / matchedRequest / risk สูง
  const detailed = r.files.filter((f) => f.notes || f.matchedRequest || f.risk !== "low");
  if (detailed.length) {
    lines.push(`## หมายเหตุเพิ่มเติม`);
    for (const f of detailed) {
      lines.push(`### \`${f.path}\``);
      if (f.matchedRequest) lines.push(`- **ตรงกับ request-change:** ${f.matchedRequest}`);
      if (f.notes) lines.push(`- **ข้อสังเกต:** ${f.notes}`);
      lines.push(`- **ความเสี่ยง:** ${RISK_LABEL[f.risk] ?? f.risk} / ความมั่นใจ: ${f.confidence}`);
      lines.push("");
    }
  }

  lines.push("");
  lines.push(`---`);
  lines.push(`**Pipeline:** อ่าน docs ด้วย \`${r.pipeline.contextModel}\` · ` +
    `วิเคราะห์โค้ด (refine chain) \`${r.pipeline.analyzeChain.join(" → ")}\` · ` +
    `เรียบเรียงสรุปด้วย \`${r.pipeline.writerModel}\``);
  lines.push(`_สร้างโดย outsource-monitor — วิเคราะห์ด้วย AI ผ่าน develyst-ai gateway_`);
  return lines.join("\n");
}

function escapeCell(s: string): string {
  return (s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

// เนื้ออีเมลสำหรับ "PM" — สรุปภาษาธุรกิจล้วน ไม่มี path/ตารางไฟล์/ศัพท์เทคนิค
// (รายละเอียดเชิงเทคนิครายไฟล์อยู่ในไฟล์ .md ที่แนบไปด้วย)
export function reportToHtml(r: AnalysisReport): string {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;max-width:760px;line-height:1.6">
  <h2 style="margin-bottom:2px">รายงานการส่งมอบงาน${r.projectName ? " — " + esc(r.projectName) : ""}</h2>
  <p style="color:#6b7280;margin-top:0;font-size:13px">
    รอบส่งมอบ: ${esc(r.baseRef)} → ${esc(r.headRef)} · วันที่ ${esc(r.generatedAt.slice(0, 10))}
  </p>

  <div style="background:#f9fafb;padding:16px 20px;border-radius:10px;border:1px solid #e5e7eb;margin-top:12px">
    ${mdToHtml(r.executiveSummary.trim())}
  </div>

  <p style="color:#9ca3af;font-size:12px;margin-top:16px">
    รายละเอียดเชิงเทคนิครายไฟล์ ดูได้ในไฟล์แนบ (.md)<br/>
    รายงานนี้สร้างและสรุปโดยระบบอัตโนมัติ
  </p>
</div>`;
}

// แปลง markdown ของสรุป → HTML แบบเรียบ ๆ (หัวข้อ/ตัวหนา/bullet/ย่อหน้า)
function mdToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, "$1")                    // ตัด code backtick
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "$1");

  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) { closeList(); continue; }

    // ข้ามเส้นคั่น / แถวคั่นตาราง
    if (/^([-=*_]\s*){3,}$/.test(t) || /^\|?\s*:?-{2,}/.test(t)) { closeList(); continue; }

    // หัวข้อ
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      out.push(`<div style="font-weight:700;margin:12px 0 4px">${inline(h[2])}</div>`);
      continue;
    }

    // bullet (- , * , 1. )
    const b = t.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
    if (b) {
      if (!inList) { out.push(`<ul style="margin:4px 0;padding-left:20px">`); inList = true; }
      out.push(`<li>${inline(b[1])}</li>`);
      continue;
    }

    // แถวตาราง markdown → รวมเซลล์เป็นบรรทัดเดียว
    if (t.startsWith("|")) {
      closeList();
      const cells = t.split("|").map((c) => c.trim()).filter(Boolean);
      out.push(`<p style="margin:4px 0">${inline(cells.join(" — "))}</p>`);
      continue;
    }

    closeList();
    out.push(`<p style="margin:8px 0">${inline(t)}</p>`);
  }
  closeList();
  return out.join("\n");
}

function esc(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

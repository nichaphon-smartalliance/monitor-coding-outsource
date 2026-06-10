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
  lines.push(`# รายงานตรวจโค้ด outsource`);
  lines.push("");
  lines.push(`- **Repo:** ${r.repo}`);
  lines.push(`- **เทียบ:** \`${r.baseRef}\` → \`${r.headRef}\``);
  lines.push(`- **สร้างเมื่อ:** ${r.generatedAt}`);
  if (r.changeRequestPath) lines.push(`- **request-change doc:** ${r.changeRequestPath}`);
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
  lines.push(`_สร้างโดย outsource-monitor — วิเคราะห์ด้วย AI ผ่าน develyst-ai gateway_`);
  return lines.join("\n");
}

function escapeCell(s: string): string {
  return (s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

// HTML แบบเรียบ ๆ สำหรับเนื้ออีเมล
export function reportToHtml(r: AnalysisReport): string {
  const rows = r.files
    .map(
      (f) => `<tr>
<td style="font-family:monospace">${esc(f.path)}</td>
<td>${esc(f.status)}</td>
<td>${esc(CLASS_LABEL[f.classification])}</td>
<td>${esc(RISK_LABEL[f.risk] ?? f.risk)}</td>
<td>${esc(f.summary)}</td>
</tr>`,
    )
    .join("\n");

  return `<div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;max-width:900px">
  <h2 style="margin-bottom:4px">รายงานตรวจโค้ด outsource</h2>
  <p style="color:#6b7280;margin-top:0">
    เทียบ <code>${esc(r.baseRef)}</code> → <code>${esc(r.headRef)}</code><br/>
    สร้างเมื่อ ${esc(r.generatedAt)}${r.changeRequestPath ? `<br/>request-change: ${esc(r.changeRequestPath)}` : ""}
  </p>

  <table style="border-collapse:collapse;margin:12px 0">
    <tr style="background:#f3f4f6">
      <th style="padding:6px 12px;border:1px solid #e5e7eb">ไฟล์ทั้งหมด</th>
      <th style="padding:6px 12px;border:1px solid #e5e7eb">ตามที่ขอ</th>
      <th style="padding:6px 12px;border:1px solid #e5e7eb">งานหลัก</th>
      <th style="padding:6px 12px;border:1px solid #e5e7eb">นอกเหนือที่ขอ</th>
      <th style="padding:6px 12px;border:1px solid #e5e7eb">เสี่ยงสูง</th>
    </tr>
    <tr style="text-align:center">
      <td style="padding:6px 12px;border:1px solid #e5e7eb">${r.stats.totalFiles}</td>
      <td style="padding:6px 12px;border:1px solid #e5e7eb">${r.stats.requested}</td>
      <td style="padding:6px 12px;border:1px solid #e5e7eb">${r.stats.mainRequirement}</td>
      <td style="padding:6px 12px;border:1px solid #e5e7eb">${r.stats.unexpected}</td>
      <td style="padding:6px 12px;border:1px solid #e5e7eb">${r.stats.highRisk}</td>
    </tr>
  </table>

  <h3>สรุปภาพรวม</h3>
  <div style="white-space:pre-wrap;background:#f9fafb;padding:12px;border-radius:8px;border:1px solid #e5e7eb">${esc(r.executiveSummary.trim())}</div>

  <h3>รายละเอียดรายไฟล์</h3>
  <table style="border-collapse:collapse;width:100%;font-size:14px">
    <tr style="background:#f3f4f6;text-align:left">
      <th style="padding:6px 8px;border:1px solid #e5e7eb">ไฟล์</th>
      <th style="padding:6px 8px;border:1px solid #e5e7eb">สถานะ</th>
      <th style="padding:6px 8px;border:1px solid #e5e7eb">ประเภท</th>
      <th style="padding:6px 8px;border:1px solid #e5e7eb">ความเสี่ยง</th>
      <th style="padding:6px 8px;border:1px solid #e5e7eb">สรุป</th>
    </tr>
    ${rows}
  </table>

  <p style="color:#9ca3af;font-size:12px;margin-top:16px">สร้างโดย outsource-monitor — วิเคราะห์ด้วย AI ผ่าน develyst-ai gateway</p>
</div>`;
}

function esc(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

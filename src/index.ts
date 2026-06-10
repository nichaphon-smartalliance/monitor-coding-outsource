#!/usr/bin/env bun
// outsource-monitor CLI
//   analyze  — เทียบ 2 branch, ให้ AI วิเคราะห์, สร้างรายงาน, (เลือก) ส่งอีเมล
//   import   — เอาโค้ดที่ vendor ส่งมาในโฟลเดอร์ ขึ้นเป็น branch ใหม่แล้ว commit ให้

import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { checkGateway } from "./ai.ts";
import { isGitRepo, refExists, listBranches, runGit } from "./git.ts";
import { loadChangeRequest } from "./changeRequest.ts";
import { runAnalysis } from "./analyze.ts";
import { reportToMarkdown, reportToHtml } from "./report.ts";
import { sendMail } from "./email.ts";
import { assertEmailConfig } from "./config.ts";

// ---------- arg parser ----------
function parseArgs(argv: string[]): { _: string[]; flags: Record<string, string | boolean> } {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

const HELP = `
outsource-monitor — ตรวจโค้ดที่ outsource ส่งมอบรายเดือนด้วย AI

ใช้งาน:
  bun run src/index.ts analyze --base <ref> --head <ref> [options]
  bun run src/index.ts import  --from <folder> --branch <name> [options]

คำสั่ง analyze:
  --base <ref>     branch/commit เดือนก่อน (จำเป็น)
  --head <ref>     branch/commit เดือนนี้ (จำเป็น)
  --repo <path>    repo เป้าหมาย (default: TARGET_REPO หรือโฟลเดอร์ปัจจุบัน)
  --cr <path>      request-change doc ของรอบนี้ (.md/.txt/.pdf) (ถ้ามี)
  --send-email     ส่งอีเมลรายงาน (เคารพ EMAIL_SEND_ENABLED ใน .env)
  --to <emails>    ผู้รับ override (คั่นด้วย comma)
  --subject <txt>  หัวข้ออีเมล override
  --out <path>     ที่เก็บรายงาน .md (default: reports/<head>-<timestamp>.md)

คำสั่ง import (ช่วยขึ้น branch ใหม่ + commit):
  --from <folder>  โฟลเดอร์โค้ดที่ vendor ส่งมา (จำเป็น)
  --branch <name>  ชื่อ branch ใหม่ เช่น 2026-06 (จำเป็น)
  --repo <path>    repo เป้าหมาย (default เหมือน analyze)
  --base <ref>     branch ตั้งต้นที่จะแตกออกมา (default: branch ปัจจุบัน)
  --message <txt>  ข้อความ commit (default: "Monthly delivery <branch>")
  --yes            ยืนยันให้เขียนจริง (ไม่ใส่ = dry-run แสดงว่าจะทำอะไร)

ตัวอย่าง:
  bun run src/index.ts analyze --repo ../vendor-repo --base 2026-05 --head 2026-06 --cr docs/cr/2026-06.md --send-email
`;

// ---------- analyze ----------
async function cmdAnalyze(flags: Record<string, string | boolean>) {
  const repo = (flags.repo as string) || config.repo;
  const baseRef = flags.base as string;
  const headRef = flags.head as string;

  if (!baseRef || !headRef) {
    fail("ต้องระบุ --base และ --head\n" + HELP);
  }
  if (!isGitRepo(repo)) fail(`ไม่ใช่ git repo: ${repo}`);
  if (!refExists(repo, baseRef)) {
    fail(`ไม่พบ ref "${baseRef}" ใน repo\nbranch ที่มี: ${listBranches(repo).join(", ")}`);
  }
  if (!refExists(repo, headRef)) {
    fail(`ไม่พบ ref "${headRef}" ใน repo\nbranch ที่มี: ${listBranches(repo).join(", ")}`);
  }

  // เช็ค gateway ก่อน
  const gw = await checkGateway();
  if (!gw.ok) {
    fail(
      `เชื่อมต่อ AI gateway ไม่ได้ที่ ${config.ai.gatewayUrl} (${gw.detail})\n` +
      `→ เปิด develyst-ai ก่อน: cd C:\\Users\\Admin\\develyst\\develyst-ai && bun run dev`,
    );
  }
  console.log(`✓ AI gateway: ${gw.detail} (${config.ai.gatewayUrl})`);

  // โหลด request-change doc
  let cr;
  if (flags.cr) {
    cr = loadChangeRequest(flags.cr as string);
    console.log(`✓ โหลด request-change: ${cr.path} (${cr.text.length} ตัวอักษร)`);
  } else {
    console.log("• ไม่มี --cr (ไม่มีเอกสาร request-change รอบนี้)");
  }

  const report = await runAnalysis({
    repo,
    baseRef,
    headRef,
    changeRequest: cr,
    onProgress: (m) => console.log(m),
  });

  // เขียนรายงาน
  const md = reportToMarkdown(report);
  const reportsDir = join(process.cwd(), "reports");
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeHead = headRef.replace(/[^\w.-]/g, "_");
  const outPath = (flags.out as string) || join(reportsDir, `${safeHead}-${stamp}.md`);
  writeFileSync(outPath, md, "utf8");
  console.log(`\n📄 รายงานถูกบันทึก: ${outPath}`);

  console.log("\n" + "=".repeat(60));
  console.log(`สรุป: ${report.stats.totalFiles} ไฟล์ | ตามที่ขอ ${report.stats.requested} | งานหลัก ${report.stats.mainRequirement} | นอกเหนือ ${report.stats.unexpected} | เสี่ยงสูง ${report.stats.highRisk}`);
  console.log("=".repeat(60));

  // อีเมล
  if (flags["send-email"]) {
    const cfgErr = assertEmailConfig();
    if (cfgErr) fail(`ส่งอีเมลไม่ได้: ${cfgErr}`);

    const to = flags.to ? (flags.to as string).split(",").map((s) => s.trim()).filter(Boolean) : config.email.to;
    const subject = (flags.subject as string) ||
      `[ตรวจโค้ด outsource] ${headRef} (เทียบ ${baseRef}) — ${report.stats.totalFiles} ไฟล์เปลี่ยน`;
    const html = reportToHtml(report);
    const attachmentB64 = Buffer.from(md, "utf8").toString("base64");

    const result = await sendMail({
      subject,
      html,
      to,
      cc: config.email.cc,
      attachments: [{ name: `report-${safeHead}.md`, contentType: "text/markdown", contentBase64: attachmentB64 }],
    });

    if (result.sent) {
      console.log(`📧 ส่งอีเมลแล้ว → ${to.join(", ")}${config.email.cc.length ? " (cc: " + config.email.cc.join(", ") + ")" : ""}`);
    } else {
      console.log(`📧 (ไม่ส่ง) ${result.reason}`);
      console.log(`   ผู้รับที่ตั้งไว้: ${to.join(", ")} — เปลี่ยน EMAIL_SEND_ENABLED=true ใน .env เพื่อส่งจริง`);
    }
  }
}

// ---------- import ----------
function cmdImport(flags: Record<string, string | boolean>) {
  const repo = (flags.repo as string) || config.repo;
  const from = flags.from as string;
  const branch = flags.branch as string;
  const dryRun = !flags.yes;

  if (!from || !branch) fail("ต้องระบุ --from และ --branch\n" + HELP);
  if (!existsSync(from)) fail(`ไม่พบโฟลเดอร์ต้นทาง: ${from}`);
  if (!isGitRepo(repo)) fail(`ไม่ใช่ git repo: ${repo}`);

  // ตรวจ working tree สะอาด
  const status = runGit(repo, ["status", "--porcelain"]);
  if (status.trim()) {
    fail(`repo มีการเปลี่ยนแปลงค้างอยู่ (working tree ไม่สะอาด) — commit/stash ก่อน:\n${status}`);
  }

  const baseRef = (flags.base as string) || runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const message = (flags.message as string) || `Monthly delivery ${branch}`;
  const exists = refExists(repo, branch);

  console.log(`แผนการ import:`);
  console.log(`  repo:        ${repo}`);
  console.log(`  จากโฟลเดอร์: ${from}`);
  console.log(`  branch ใหม่: ${branch}${exists ? " (มีอยู่แล้ว — จะ checkout)" : ` (สร้างใหม่จาก ${baseRef})`}`);
  console.log(`  commit msg:  ${message}`);

  if (dryRun) {
    console.log(`\n[dry-run] ยังไม่เขียนอะไร — เพิ่ม --yes เพื่อทำจริง`);
    return;
  }

  // 1) สร้าง/เช็คเอาท์ branch
  if (exists) {
    runGit(repo, ["checkout", branch]);
  } else {
    runGit(repo, ["checkout", "-b", branch, baseRef]);
  }

  // 2) ลบไฟล์เดิมทั้งหมด (ยกเว้น .git) แล้วก๊อปของใหม่เข้าไป (mirror)
  for (const entry of readdirSync(repo)) {
    if (entry === ".git") continue;
    rmSync(join(repo, entry), { recursive: true, force: true });
  }
  for (const entry of readdirSync(from)) {
    if (entry === ".git") continue; // ไม่เอา .git ของ vendor
    cpSync(join(from, entry), join(repo, entry), { recursive: true });
  }

  // 3) commit
  runGit(repo, ["add", "-A"]);
  const staged = runGit(repo, ["status", "--porcelain"]);
  if (!staged.trim()) {
    console.log("ไม่มีการเปลี่ยนแปลงหลังก๊อปไฟล์ (โค้ดเหมือนเดิม) — ไม่ commit");
    return;
  }
  runGit(repo, ["commit", "-m", message]);
  const sha = runGit(repo, ["rev-parse", "--short", "HEAD"]).trim();
  console.log(`\n✓ commit แล้วบน branch ${branch} (${sha})`);
  console.log(`ถัดไป: bun run src/index.ts analyze --repo "${repo}" --base ${baseRef} --head ${branch} --cr <doc>`);
}

// ---------- main ----------
function fail(msg: string): never {
  console.error("❌ " + msg);
  process.exit(1);
}

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0];

  if (!cmd || flags.help || cmd === "help") {
    console.log(HELP);
    return;
  }

  switch (cmd) {
    case "analyze": await cmdAnalyze(flags); break;
    case "import": cmdImport(flags); break;
    default:
      console.log(`ไม่รู้จักคำสั่ง: ${cmd}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ " + (err?.message ?? err));
  process.exit(1);
});

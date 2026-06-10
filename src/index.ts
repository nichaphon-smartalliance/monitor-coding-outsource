#!/usr/bin/env bun
// outsource-monitor CLI
//   analyze  — เทียบ 2 branch, ให้ AI วิเคราะห์, สร้างรายงาน, (เลือก) ส่งอีเมล
//   import   — เอาโค้ดที่ vendor ส่งมาในโฟลเดอร์ ขึ้นเป็น branch ใหม่แล้ว commit ให้

import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { checkGateway } from "./ai.ts";
import { isGitRepo, refExists, listBranches, runGit } from "./git.ts";
import { loadDoc } from "./changeRequest.ts";
import { runAnalysis } from "./analyze.ts";
import { reportToMarkdown, reportToHtml } from "./report.ts";
import { sendMail } from "./email.ts";
import { assertEmailConfig } from "./config.ts";
import { loadProject, listProjects, resolvePath } from "./projects.ts";
import type { LoadedDoc, ProjectConfig } from "./types.ts";

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
outsource-monitor — ตรวจโค้ดที่ outsource ส่งมอบด้วย AI (รองรับหลายโปรเจกต์)

ใช้งาน (แบบสั้น — แนะนำ):
  bun run src/index.ts projects                         # ดูรายการโปรเจกต์ที่ตั้งค่าไว้
  bun run src/index.ts analyze --project <id> --base <ref> --head <ref> [--send-email]
  bun run src/index.ts import  --project <id> --from <folder> --branch <name> [--yes]

คำสั่ง analyze:
  --project <id>   ชื่อโปรเจกต์ (อ่าน repo/requirement/CR จาก projects/<id>.json)
  --base <ref>     branch ส่งมอบรอบก่อน (จำเป็น)
  --head <ref>     branch ส่งมอบรอบนี้ (จำเป็น)
  --send-email     ส่งอีเมลรายงาน (เคารพ EMAIL_SEND_ENABLED ใน .env)
  --to <emails>    ผู้รับ override (คั่นด้วย comma)
  --subject <txt>  หัวข้ออีเมล override
  --out <path>     ที่เก็บรายงาน .md
  (ไม่ใช้ --project ก็ได้ ระบุเองด้วย --repo, --requirement, --cr)

คำสั่ง import (ช่วยขึ้น branch ใหม่ + commit):
  --project <id>   ใช้ repo ของโปรเจกต์นี้ (หรือระบุ --repo เอง)
  --from <folder>  โฟลเดอร์โค้ดที่ vendor ส่งมา (จำเป็น)
  --branch <name>  ชื่อ branch ใหม่ (จำเป็น)
  --base <ref>     branch ตั้งต้น (default: branch ปัจจุบัน)
  --yes            ยืนยันเขียนจริง (ไม่ใส่ = dry-run)

ตัวอย่าง:
  bun run src/index.ts analyze --project shopx --base delivery-3 --head delivery-4 --send-email
`;

// ---------- analyze ----------
async function cmdAnalyze(flags: Record<string, string | boolean>) {
  // ถ้าระบุ --project จะดึง repo/requirement/cr/ผู้รับ จากทะเบียนโปรเจกต์
  const project: ProjectConfig | undefined = flags.project ? loadProject(flags.project as string) : undefined;
  if (project) console.log(`✓ โปรเจกต์: ${project.name} (${project.id})`);

  const repo = (flags.repo as string) || (project ? resolvePath(project.repo) : config.repo);
  const baseRef = (flags.base as string) || project?.baseBranch || "";
  const headRef = flags.head as string;

  if (!baseRef || !headRef) {
    fail("ต้องระบุ --base และ --head (หรือใส่ baseBranch ใน config โปรเจกต์)\n" + HELP);
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
      `→ ถ้าใช้ server: เช็คเน็ต/URL ใน .env (ค่าปัจจุบัน ${config.ai.gatewayUrl})\n` +
      `→ ถ้าใช้ local: เปิด develyst-ai ก่อน (cd C:\\Users\\Admin\\develyst\\develyst-ai && bun run dev) แล้วตั้ง AI_GATEWAY_URL=http://localhost:3009`,
    );
  }
  console.log(`✓ AI gateway: ${gw.detail} (${config.ai.gatewayUrl})`);

  // โหลด project requirement (สเปกตั้งต้น)
  let requirement: LoadedDoc | undefined;
  const reqPath = (flags.requirement as string) || project?.requirementDoc;
  if (reqPath) {
    requirement = loadDoc(resolvePath(reqPath), "project requirement");
    console.log(`✓ requirement: ${requirement.path} (${requirement.text.length} ตัวอักษร)`);
  } else {
    console.log("• ไม่มี requirement doc (จะวิเคราะห์จาก base docs ใน repo เท่านั้น)");
  }

  // โหลด request-change backlog
  let cr: LoadedDoc | undefined;
  const crPath = (flags.cr as string) || project?.changeRequests;
  if (crPath) {
    cr = loadDoc(resolvePath(crPath), "request-change backlog");
    console.log(`✓ request-change backlog: ${cr.path} (${cr.text.length} ตัวอักษร)`);
  } else {
    console.log("• ไม่มี request-change backlog");
  }

  const report = await runAnalysis({
    repo,
    baseRef,
    headRef,
    projectName: project?.name,
    requirement,
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

    const to = flags.to
      ? (flags.to as string).split(",").map((s) => s.trim()).filter(Boolean)
      : (project?.emailTo?.length ? project.emailTo : config.email.to);
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
  const project = flags.project ? loadProject(flags.project as string) : undefined;
  const repo = (flags.repo as string) || (project ? resolvePath(project.repo) : config.repo);
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
  const next = project
    ? `bun run src/index.ts analyze --project ${project.id} --base ${baseRef} --head ${branch}`
    : `bun run src/index.ts analyze --repo "${repo}" --base ${baseRef} --head ${branch} --cr <doc>`;
  console.log(`ถัดไป: ${next}`);
}

// ---------- projects ----------
function cmdProjects() {
  const projects = listProjects();
  if (projects.length === 0) {
    console.log("ยังไม่มีโปรเจกต์ — สร้างไฟล์ใน projects/<id>.json (ดูตัวอย่าง projects/example.json)");
    return;
  }
  console.log(`โปรเจกต์ที่ตั้งค่าไว้ (${projects.length}):\n`);
  for (const p of projects) {
    console.log(`• ${p.id} — ${p.name}`);
    console.log(`    repo:        ${p.repo}`);
    console.log(`    requirement: ${p.requirementDoc ?? "(ไม่ได้ตั้ง)"}`);
    console.log(`    change-req:  ${p.changeRequests ?? "(ไม่ได้ตั้ง)"}`);
    if (p.emailTo?.length) console.log(`    emailTo:     ${p.emailTo.join(", ")}`);
    console.log("");
  }
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
    case "projects": cmdProjects(); break;
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

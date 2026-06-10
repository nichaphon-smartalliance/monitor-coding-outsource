// ทำงานกับ git: เทียบ 2 ref, ดึง diff, อ่านไฟล์ที่ ref ใด ref หนึ่ง

import { execFileSync } from "node:child_process";
import type { ChangedFile, FileStatus } from "./types.ts";

const MAX_PATCH_CHARS = 16000; // กัน patch ยาวเกินจน token บาน

export function runGit(repo: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err: any) {
    const msg = err?.stderr?.toString?.() || err?.message || String(err);
    throw new Error(`git ${args.join(" ")} ล้มเหลว: ${msg.trim()}`);
  }
}

export function isGitRepo(repo: string): boolean {
  try {
    runGit(repo, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export function refExists(repo: string, ref: string): boolean {
  try {
    runGit(repo, ["rev-parse", "--verify", "--quiet", ref + "^{commit}"]);
    return true;
  } catch {
    return false;
  }
}

export function listBranches(repo: string): string[] {
  const out = runGit(repo, ["branch", "--format=%(refname:short)"]);
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function mapStatus(letter: string): FileStatus {
  const c = letter[0]?.toUpperCase();
  switch (c) {
    case "A": return "added";
    case "M": return "modified";
    case "D": return "deleted";
    case "R": return "renamed";
    default: return "other";
  }
}

// อ่านเนื้อไฟล์ที่ ref หนึ่ง ๆ (เช่นไว้รวบรวม base docs) คืน "" ถ้าไม่มี
export function readFileAtRef(repo: string, ref: string, path: string): string {
  try {
    return runGit(repo, ["show", `${ref}:${path}`]);
  } catch {
    return "";
  }
}

// รายชื่อไฟล์ทั้งหมดที่ ref (ไว้หา docs)
export function listFilesAtRef(repo: string, ref: string): string[] {
  const out = runGit(repo, ["ls-tree", "-r", "--name-only", ref]);
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

// เทียบ base..head แล้วคืนรายการไฟล์ที่เปลี่ยน พร้อม patch
export function diffFiles(repo: string, base: string, head: string): ChangedFile[] {
  const range = `${base}..${head}`;

  // numstat: additions \t deletions \t path  (binary = "-\t-")
  const numstat = runGit(repo, ["diff", "--numstat", "-M", range]);
  // name-status: R100\told\tnew  /  M\tpath
  const namestatus = runGit(repo, ["diff", "--name-status", "-M", range]);

  const statusByPath = new Map<string, { status: FileStatus; oldPath?: string }>();
  for (const line of namestatus.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0];
    const status = mapStatus(code);
    if (status === "renamed" && parts.length >= 3) {
      statusByPath.set(parts[2], { status, oldPath: parts[1] });
    } else {
      statusByPath.set(parts[parts.length - 1], { status });
    }
  }

  const files: ChangedFile[] = [];
  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const addRaw = parts[0];
    const delRaw = parts[1];
    let path = parts.slice(2).join("\t");

    // รูปแบบ rename ใน numstat: "old => new" หรือ "{a => b}/x"
    if (path.includes("=>")) {
      const m = path.match(/\{(.*?) => (.*?)\}/);
      if (m) {
        path = path.replace(/\{.*? => (.*?)\}/, "$1");
      } else {
        path = path.split("=>").pop()!.trim();
      }
    }

    const binary = addRaw === "-" && delRaw === "-";
    const meta = statusByPath.get(path) ?? { status: "modified" as FileStatus };

    let patch = "";
    let truncated = false;
    if (!binary) {
      try {
        patch = runGit(repo, ["diff", "-M", range, "--", path]);
      } catch {
        patch = "";
      }
      if (patch.length > MAX_PATCH_CHARS) {
        patch = patch.slice(0, MAX_PATCH_CHARS) + "\n... [diff ถูกตัดเพราะยาวเกิน] ...";
        truncated = true;
      }
    }

    files.push({
      path,
      oldPath: meta.oldPath,
      status: meta.status,
      additions: binary ? 0 : Number(addRaw) || 0,
      deletions: binary ? 0 : Number(delRaw) || 0,
      patch,
      truncated,
      binary,
    });
  }

  return files;
}

// shortlog ของ commits ใน range (ไว้ใส่ในรายงานเป็นภาพรวม)
export function commitLog(repo: string, base: string, head: string): string {
  try {
    return runGit(repo, ["log", "--pretty=format:- %h %s (%an)", `${base}..${head}`]);
  } catch {
    return "";
  }
}

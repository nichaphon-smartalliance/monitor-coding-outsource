// ทะเบียนโปรเจกต์: อ่าน config ราย project จากโฟลเดอร์ projects/<id>.json
// ทำให้รองรับหลายโปรเจกต์ และเรียกใช้ด้วยแค่ชื่อ project

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, isAbsolute, basename } from "node:path";
import type { ProjectConfig } from "./types.ts";

// โฟลเดอร์เก็บ config (อยู่ที่ root ของ tool)
const PROJECTS_DIR = join(process.cwd(), "projects");

// แปลง path ใน config (relative = อิงจาก root ของ tool) ให้เป็น absolute
export function resolvePath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

export function listProjects(): ProjectConfig[] {
  if (!existsSync(PROJECTS_DIR)) return [];
  return readdirSync(PROJECTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => loadProjectFromFile(join(PROJECTS_DIR, f)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function loadProject(id: string): ProjectConfig {
  const file = join(PROJECTS_DIR, `${id}.json`);
  if (!existsSync(file)) {
    const available = listProjects().map((p) => p.id);
    throw new Error(
      `ไม่พบโปรเจกต์ "${id}" (หาไฟล์ projects/${id}.json ไม่เจอ)` +
      (available.length ? `\nโปรเจกต์ที่มี: ${available.join(", ")}` : `\nยังไม่มีโปรเจกต์ — สร้างไฟล์ใน projects/ ก่อน`),
    );
  }
  return loadProjectFromFile(file);
}

function loadProjectFromFile(file: string): ProjectConfig {
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err: any) {
    throw new Error(`อ่าน config โปรเจกต์ไม่ได้ (${file}): ${err?.message ?? err}`);
  }
  const id = raw.id || basename(file, ".json");
  if (!raw.repo) throw new Error(`config ${file} ขาดฟิลด์ "repo"`);
  return {
    id,
    name: raw.name || id,
    repo: raw.repo,
    requirementDoc: raw.requirementDoc,
    changeRequests: raw.changeRequests,
    baseBranch: raw.baseBranch,
    emailTo: Array.isArray(raw.emailTo) ? raw.emailTo : undefined,
  };
}

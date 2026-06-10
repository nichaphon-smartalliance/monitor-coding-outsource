// โหลด request-change doc ของเดือนนั้น (md / txt / pdf)
// pdf จะพยายามใช้ pdftotext (poppler) ถ้ามีในเครื่อง ไม่งั้นแจ้งให้แปลงเป็น .md/.txt

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname } from "node:path";
import type { LoadedDoc } from "./types.ts";

// โหลดเอกสารใด ๆ (requirement / change-request) เป็น text — รองรับ md/txt/pdf
export function loadDoc(path: string, label = "เอกสาร"): LoadedDoc {
  if (!existsSync(path)) {
    throw new Error(`ไม่พบไฟล์ ${label}: ${path}`);
  }
  const ext = extname(path).toLowerCase();

  if (ext === ".pdf") {
    return { path, text: pdfToText(path) };
  }
  // md/txt/markdown หรือไม่รู้จักนามสกุล → อ่านเป็น text
  return { path, text: readFileSync(path, "utf8") };
}

// alias เดิม
export function loadChangeRequest(path: string): LoadedDoc {
  return loadDoc(path, "request-change doc");
}

function pdfToText(path: string): string {
  try {
    // poppler: pdftotext <in> -  (ส่งออก stdout)
    const out = execFileSync("pdftotext", ["-layout", path, "-"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (out.trim()) return out;
    throw new Error("empty");
  } catch {
    throw new Error(
      `อ่าน PDF ไม่ได้ (ไม่พบ pdftotext หรืออ่านไม่ออก): ${path}\n` +
      `วิธีแก้: ติดตั้ง poppler (pdftotext) หรือแปลงไฟล์เป็น .md/.txt แล้วชี้ --cr ไปที่ไฟล์นั้นแทน`,
    );
  }
}

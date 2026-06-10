// โหลด request-change doc ของเดือนนั้น (md / txt / pdf)
// pdf จะพยายามใช้ pdftotext (poppler) ถ้ามีในเครื่อง ไม่งั้นแจ้งให้แปลงเป็น .md/.txt

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname } from "node:path";
import type { ChangeRequestDoc } from "./types.ts";

export function loadChangeRequest(path: string): ChangeRequestDoc {
  if (!existsSync(path)) {
    throw new Error(`ไม่พบไฟล์ request-change doc: ${path}`);
  }
  const ext = extname(path).toLowerCase();

  if (ext === ".md" || ext === ".txt" || ext === ".markdown") {
    return { path, text: readFileSync(path, "utf8") };
  }

  if (ext === ".pdf") {
    const text = pdfToText(path);
    return { path, text };
  }

  // ไม่รู้จักนามสกุล ลองอ่านเป็น text
  return { path, text: readFileSync(path, "utf8") };
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

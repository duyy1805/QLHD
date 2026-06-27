import { mkdir, writeFile } from "fs/promises";
import path from "path";

const MAX_SIZE = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg"]);

export type SavedFile = {
  fileName: string;
  fileUrl: string;
  filePath: string;
  fileSize: number;
  fileType: string;
};

export async function saveUpload(file: File): Promise<SavedFile> {
  if (!file || file.size === 0) throw new Error("File là bắt buộc.");
  if (file.size > MAX_SIZE) throw new Error("File vượt quá giới hạn 20MB.");

  const original = path.basename(file.name);
  const ext = path.extname(original).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error("Định dạng file không được hỗ trợ.");

  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dir = path.join(process.cwd(), "public", "uploads", "documents", yyyy, mm);
  await mkdir(dir, { recursive: true });

  const safeName = original.replace(/[^\p{L}\p{N}._ -]/gu, "_");
  const storedName = `${Date.now()}-${safeName}`;
  const filePath = path.join(dir, storedName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, bytes);

  return {
    fileName: original,
    fileUrl: `/uploads/documents/${yyyy}/${mm}/${storedName}`,
    filePath,
    fileSize: file.size,
    fileType: file.type || ext.slice(1),
  };
}

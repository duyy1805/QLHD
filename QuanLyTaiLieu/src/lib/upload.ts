import path from "path";
import { uploadFileToDrive } from "@/lib/google-drive";

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
  if (!file || file.size === 0) throw new Error("File l\u00e0 b\u1eaft bu\u1ed9c.");
  if (file.size > MAX_SIZE) throw new Error("File v\u01b0\u1ee3t qu\u00e1 gi\u1edbi h\u1ea1n 20MB.");

  const original = path.basename(file.name);
  const ext = path.extname(original).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error("\u0110\u1ecbnh d\u1ea1ng file kh\u00f4ng \u0111\u01b0\u1ee3c h\u1ed7 tr\u1ee3.");

  const safeName = original.replace(/[^\p{L}\p{N}._ -]/gu, "_");
  const storedName = `${Date.now()}-${safeName}`;
  const driveFileId = await uploadFileToDrive(file, storedName);

  return {
    fileName: original,
    fileUrl: `/api/files/${driveFileId}`,
    filePath: `drive:${driveFileId}`,
    fileSize: file.size,
    fileType: file.type || ext.slice(1),
  };
}
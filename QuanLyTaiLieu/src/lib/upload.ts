import path from "path";
import { uploadFileToDrive } from "@/lib/google-drive";

const MAX_SIZE = 150 * 1024 * 1024;
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
  if (file.size > MAX_SIZE) throw new Error("File vượt quá giới hạn 150MB.");

  const original = path.basename(file.name);
  const ext = path.extname(original).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error("Định dạng file không được hỗ trợ.");

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

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteDriveFileByPath } from "@/lib/google-drive";
import { saveUpload, type SavedFile } from "@/lib/upload";
import { uploadAssignmentFile } from "@/services/document.service";

export const runtime = "nodejs";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Không thể upload file xử lý.";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });

  try {
    const { id } = await params;
    const form = await request.formData();
    const files = form.getAll("file").filter((item): item is File => item instanceof File);
    const file = files[0];
    if (!(file instanceof File)) return NextResponse.json({ message: "File là bắt buộc." }, { status: 400 });

    const savedFiles: SavedFile[] = [];
    try {
      for (const item of files) {
        savedFiles.push(await saveUpload(item));
      }

      for (const savedFile of savedFiles) {
        await uploadAssignmentFile(Number(id), savedFile, String(form.get("note") || "") || null, user);
      }
    } catch (error) {
      await Promise.all(savedFiles.map((item) => deleteDriveFileByPath(item.filePath).catch(() => undefined)));
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ message: getErrorMessage(error) }, { status: 400 });
  }
}

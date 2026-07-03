import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createDocumentSchema, updateDocumentSchema } from "@/schemas/document.schema";
import { createDocument, listDocuments, updateDocument } from "@/services/document.service";
import { saveUpload, type SavedFile } from "@/lib/upload";
import { deleteDriveFileByPath } from "@/lib/google-drive";
import { getDocumentTypeById } from "@/services/document-type.service";
import { toInt } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return NextResponse.json(await listDocuments(searchParams.get("type") || undefined, searchParams.get("q") || undefined, searchParams.get("status") || undefined));
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });
  const form = await request.formData();
  const files = form.getAll("file").filter((item): item is File => item instanceof File);
  const file = files[0];
  if (!(file instanceof File)) return NextResponse.json({ message: "File là bắt buộc." }, { status: 400 });
  const parsed = createDocumentSchema.safeParse({
    documentTypeId: toInt(form.get("documentTypeId")),
    title: String(form.get("title") || ""),
    documentNo: String(form.get("documentNo") || "") || null,
    description: String(form.get("description") || "") || null,
    versionNo: String(form.get("versionNo") || "") || null,
    changeNote: String(form.get("changeNote") || "") || null,
    assignedToUserId: toInt(form.get("assignedToUserId")),
    dueDate: String(form.get("dueDate") || "") || null,
  });
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message || "Dữ liệu không hợp lệ." }, { status: 400 });
  const docType = await getDocumentTypeById(parsed.data.documentTypeId);
  if (!docType) return NextResponse.json({ message: "Loại tài liệu không tồn tại." }, { status: 400 });
  if (files.length > 1 && docType.moduleKind !== "ASSIGNMENT_DOCUMENT") {
    return NextResponse.json({ message: "Loại tài liệu này chỉ hỗ trợ 1 file cho mỗi phiên bản." }, { status: 400 });
  }

  const savedFiles: SavedFile[] = [];
  try {
    for (const item of files) {
      savedFiles.push(await saveUpload(item));
    }

    const id = await createDocument(parsed.data, savedFiles, user, docType.moduleKind);
    return NextResponse.json({ id });
  } catch (error) {
    await Promise.all(savedFiles.map((item) => deleteDriveFileByPath(item.filePath).catch(() => undefined)));
    const message = error instanceof Error ? error.message : "Không tạo được tài liệu.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });
  const body = await request.json();
  const parsed = updateDocumentSchema.safeParse(body);
  if (!parsed.success || !body.id) return NextResponse.json({ message: "Dữ liệu không hợp lệ." }, { status: 400 });
  await updateDocument(Number(body.id), parsed.data, user);
  return NextResponse.json({ ok: true });
}

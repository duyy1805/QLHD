import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteDocument, deleteDocumentAttachment, getDocument, uploadDocumentAttachments } from "@/services/document.service";
import { deleteDriveFileByPath } from "@/lib/google-drive";
import { saveUpload, type SavedFile } from "@/lib/upload";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await getDocument(Number(id));
  if (!document) return NextResponse.json({ message: "Không tìm thấy tài liệu." }, { status: 404 });
  return NextResponse.json(document);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });

  const { id } = await params;
  const documentId = Number(id);
  if (!Number.isFinite(documentId) || documentId <= 0) {
    return NextResponse.json({ message: "Mã tài liệu không hợp lệ." }, { status: 400 });
  }

  try {
    await deleteDocument(documentId, user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return deleteErrorResponse(error, "Không thể xoá tài liệu.");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });

  const { id } = await params;
  const documentId = Number(id);
  if (!Number.isFinite(documentId) || documentId <= 0) {
    return NextResponse.json({ message: "Mã tài liệu không hợp lệ." }, { status: 400 });
  }

  const document = await getDocument(documentId);
  if (!document) return NextResponse.json({ message: "Không tìm thấy tài liệu." }, { status: 404 });
  if (document.moduleKind !== "ASSIGNMENT_DOCUMENT") {
    return NextResponse.json({ message: "Chỉ thông báo mới hỗ trợ thêm file gốc." }, { status: 400 });
  }

  const form = await request.formData();
  const files = form.getAll("file").filter((item): item is File => item instanceof File);
  if (files.length === 0) return NextResponse.json({ message: "File là bắt buộc." }, { status: 400 });

  const savedFiles: SavedFile[] = [];
  try {
    for (const file of files) {
      savedFiles.push(await saveUpload(file));
    }

    await uploadDocumentAttachments(documentId, savedFiles, String(form.get("note") || "") || null, user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await Promise.all(savedFiles.map((file) => deleteDriveFileByPath(file.filePath).catch(() => undefined)));
    const message = error instanceof Error ? error.message : "Không thể upload file gốc.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });

  const { id } = await params;
  const documentId = Number(id);
  const body = await request.json().catch(() => null) as { action?: string; attachmentId?: number } | null;

  if (!Number.isFinite(documentId) || documentId <= 0 || body?.action !== "deleteAttachment" || !body.attachmentId) {
    return NextResponse.json({ message: "Dữ liệu không hợp lệ." }, { status: 400 });
  }

  try {
    await deleteDocumentAttachment(documentId, Number(body.attachmentId), user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return deleteErrorResponse(error, "Không thể xoá file gốc.");
  }
}

function deleteErrorResponse(error: unknown, fallback: string) {
  const err = error as { message?: string; number?: number };
  const message = err.message || fallback;

  if (err.number === 73303) return NextResponse.json({ message }, { status: 403 });
  if (err.number === 73301 || err.number === 73302) return NextResponse.json({ message }, { status: 404 });
  if (err.number === 73304) return NextResponse.json({ message }, { status: 400 });

  return NextResponse.json({ message }, { status: 500 });
}

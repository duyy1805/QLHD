import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteDocumentVersion } from "@/services/document.service";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });

  const { id, versionId } = await params;
  const documentId = Number(id);
  const documentVersionId = Number(versionId);

  if (!Number.isFinite(documentId) || documentId <= 0 || !Number.isFinite(documentVersionId) || documentVersionId <= 0) {
    return NextResponse.json({ message: "Mã phiên bản không hợp lệ." }, { status: 400 });
  }

  try {
    await deleteDocumentVersion(documentId, documentVersionId, user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return deleteErrorResponse(error, "Không thể xoá phiên bản tài liệu.");
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

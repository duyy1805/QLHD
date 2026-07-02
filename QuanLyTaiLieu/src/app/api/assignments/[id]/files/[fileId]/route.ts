import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteAssignmentFile } from "@/services/document.service";

export const runtime = "nodejs";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Không thể xoá file xử lý.";
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });

  try {
    const { id, fileId } = await params;
    await deleteAssignmentFile(Number(id), Number(fileId), user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ message: getErrorMessage(error) }, { status: 400 });
  }
}
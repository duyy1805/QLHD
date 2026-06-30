import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { saveUpload } from "@/lib/upload";
import { uploadNewVersion } from "@/services/document.service";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });
  const { id } = await params;
  const form = await request.formData();
  const file = form.get("file");
  const versionNo = String(form.get("versionNo") || "");
  if (!versionNo) return NextResponse.json({ message: "Phiên bản là bắt buộc." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ message: "File là bắt buộc." }, { status: 400 });
  const savedFile = await saveUpload(file);
  await uploadNewVersion(Number(id), versionNo, savedFile, String(form.get("changeNote") || "") || null, user);
  return NextResponse.json({ ok: true });
}

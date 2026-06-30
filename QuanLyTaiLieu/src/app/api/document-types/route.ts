import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { documentTypeSchema } from "@/schemas/document-type.schema";
import { listDocumentTypes, setDocumentTypeActive, upsertDocumentType } from "@/services/document-type.service";

export async function GET() {
  return NextResponse.json(await listDocumentTypes(false));
}

export async function POST(request: Request) {
  const user = await getSession();
  if (user?.role !== "ADMIN") return NextResponse.json({ message: "Chỉ admin được quản lý loại tài liệu." }, { status: 403 });
  const parsed = documentTypeSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message || "Dữ liệu không hợp lệ." }, { status: 400 });
  return NextResponse.json(await upsertDocumentType(parsed.data));
}

export async function PATCH(request: Request) {
  const user = await getSession();
  if (user?.role !== "ADMIN") return NextResponse.json({ message: "Chỉ admin được quản lý loại tài liệu." }, { status: 403 });
  const body = await request.json();
  await setDocumentTypeActive(Number(body.id), Boolean(body.isActive));
  return NextResponse.json({ ok: true });
}

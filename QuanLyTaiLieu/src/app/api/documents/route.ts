import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createDocumentSchema, updateDocumentSchema } from "@/schemas/document.schema";
import { createDocument, listDocuments, updateDocument } from "@/services/document.service";
import { saveUpload } from "@/lib/upload";
import { toInt } from "@/lib/utils";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return NextResponse.json(await listDocuments(searchParams.get("type") || undefined, searchParams.get("q") || undefined, searchParams.get("status") || undefined));
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
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
  const savedFile = await saveUpload(file);
  const id = await createDocument(parsed.data, savedFile, user);
  return NextResponse.json({ id });
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

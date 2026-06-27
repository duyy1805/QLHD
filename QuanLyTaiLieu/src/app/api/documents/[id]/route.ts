import { NextResponse } from "next/server";
import { getDocument } from "@/services/document.service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await getDocument(Number(id));
  if (!document) return NextResponse.json({ message: "Không tìm thấy tài liệu." }, { status: 404 });
  return NextResponse.json(document);
}

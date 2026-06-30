import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { completeAssignmentSchema } from "@/schemas/assignment.schema";
import { completeAssignment } from "@/services/assignment.service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });
  const { id } = await params;
  const parsed = completeAssignmentSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: "Dữ liệu không hợp lệ." }, { status: 400 });
  await completeAssignment(Number(id), parsed.data.completionNote || null, user);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createAssignmentSchema } from "@/schemas/assignment.schema";
import { createAssignment, listAssignments } from "@/services/assignment.service";

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });
  const mine = new URL(request.url).searchParams.get("mine") === "1";
  return NextResponse.json(await listAssignments(user, mine));
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ message: "Bạn chưa đăng nhập." }, { status: 401 });
  const parsed = createAssignmentSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: "Dữ liệu không hợp lệ." }, { status: 400 });
  await createAssignment(parsed.data.documentId, parsed.data.assignedToUserId || null, parsed.data.dueDate || null, user);
  return NextResponse.json({ ok: true });
}

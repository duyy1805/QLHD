import { NextResponse } from "next/server";
import { z } from "zod";
import { login } from "@/lib/auth";

const schema = z.object({ username: z.string().min(1), password: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: "Thiếu tài khoản hoặc mật khẩu." }, { status: 400 });
  const user = await login(parsed.data.username, parsed.data.password);
  if (!user) return NextResponse.json({ message: "Tài khoản hoặc mật khẩu không đúng." }, { status: 401 });
  return NextResponse.json({ user });
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault();
      setLoading(true);
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      setLoading(false);
      if (!res.ok) { toast.error((await res.json()).message || "Đăng nhập thất bại"); return; }
      toast.success("Đăng nhập thành công");
      router.push("/dashboard");
      router.refresh();
    }}>
      <div className="space-y-2"><label className="text-sm font-medium">Tài khoản</label><Input name="username" autoComplete="username" required /></div>
      <div className="space-y-2"><label className="text-sm font-medium">Mật khẩu</label><Input name="password" type="password" autoComplete="current-password" required /></div>
      <Button className="w-full" disabled={loading}>{loading ? "Đang đăng nhập..." : "Đăng nhập"}</Button>
    </form>
  );
}

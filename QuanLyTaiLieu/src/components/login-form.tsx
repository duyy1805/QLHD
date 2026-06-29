"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, LockKeyhole, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);

        try {
          const data = Object.fromEntries(new FormData(event.currentTarget));

          const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });

          if (!res.ok) {
            const error = await res.json().catch(() => null);
            toast.error(error?.message || "Đăng nhập thất bại");
            return;
          }

          toast.success("Đăng nhập thành công");
          router.push("/dashboard");
          router.refresh();
        } catch {
          toast.error("Có lỗi xảy ra khi đăng nhập");
        } finally {
          setLoading(false);
        }
      }}
    >
      <div className="space-y-2">
        <label
          htmlFor="username"
          className="text-sm font-semibold text-slate-700"
        >
          Tài khoản
        </label>

        <div className="relative">
          <UserRound className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-slate-400" />

          <Input
            id="username"
            name="username"
            autoComplete="username"
            required
            disabled={loading}
            placeholder="Nhập tài khoản"
            className="h-12 rounded-2xl border-slate-200 bg-white pl-12 pr-4 text-base text-slate-900 shadow-none placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-50 disabled:text-slate-500"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="password"
          className="text-sm font-semibold text-slate-700"
        >
          Mật khẩu
        </label>

        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-slate-400" />

          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            disabled={loading}
            placeholder="Nhập mật khẩu"
            className="h-12 rounded-2xl border-slate-200 bg-white pl-12 pr-12 text-base text-slate-900 shadow-none placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-50 disabled:text-slate-500"
          />

          <button
            type="button"
            disabled={loading}
            onClick={() => setShowPassword((value) => !value)}
            className="absolute right-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-50"
            aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          >
            {showPassword ? (
              <EyeOff className="h-5 w-5" />
            ) : (
              <Eye className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      <Button
        type="submit"
        disabled={loading}
        className="mt-2 h-12 w-full rounded-2xl bg-blue-700 text-base font-semibold text-white shadow-lg shadow-blue-700/25 transition hover:bg-blue-800 disabled:bg-blue-400"
      >
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Đang đăng nhập...
          </>
        ) : (
          "Đăng nhập hệ thống"
        )}
      </Button>
    </form>
  );
}

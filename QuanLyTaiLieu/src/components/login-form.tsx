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
      className="space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);

        const data = Object.fromEntries(new FormData(event.currentTarget));

        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        setLoading(false);

        if (!res.ok) {
          toast.error((await res.json()).message || "Đăng nhập thất bại");
          return;
        }

        toast.success("Đăng nhập thành công");
        router.push("/dashboard");
        router.refresh();
      }}
    >
      <div className="space-y-2">
        <label
          htmlFor="username"
          className="text-sm font-medium text-foreground"
        >
          Tài khoản
        </label>

        <div className="relative">
          <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="username"
            name="username"
            autoComplete="username"
            required
            disabled={loading}
            placeholder="Nhập tài khoản"
            className="h-11 rounded-xl border-input bg-card pl-10 text-foreground placeholder:text-muted-foreground focus:bg-card"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="password"
            className="text-sm font-medium text-foreground"
          >
            Mật khẩu
          </label>
        </div>

        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            disabled={loading}
            placeholder="Nhập mật khẩu"
            className="h-11 rounded-xl border-input bg-card pl-10 pr-10 text-foreground placeholder:text-muted-foreground focus:bg-card"
          />

          <button
            type="button"
            disabled={loading}
            onClick={() => setShowPassword((value) => !value)}
            className="absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <Button
        className="h-11 w-full rounded-xl bg-primary font-semibold text-white shadow-lg shadow-primary/20 hover:bg-primary/90"
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang đăng nhập...
          </>
        ) : (
          "Đăng nhập hệ thống"
        )}
      </Button>
    </form>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Bell,
  ChevronRight,
  FileText,
  FolderKanban,
  Home,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";

import { LogoutButton } from "@/components/layout/logout-button";
import { cn } from "@/lib/utils";
import { getSession } from "@/lib/auth";
import { listDocumentTypes } from "@/services/document-type.service";

export async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const types = await listDocumentTypes(true);

  const roleLabel =
    user.role === "ADMIN"
      ? "Quản trị viên"
      : user.role === "TBP"
        ? "Trưởng bộ phận"
        : "Người dùng";

  const roleClassName =
    user.role === "ADMIN"
      ? "border-violet-200 bg-violet-50 text-violet-700"
      : user.role === "TBP"
        ? "border-blue-200 bg-blue-50 text-blue-700"
        : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-slate-200 via-slate-100 to-transparent" />
        <div className="absolute left-24 top-24 h-72 w-72 rounded-full bg-blue-200/40 blur-3xl" />
        <div className="absolute right-24 top-28 h-72 w-72 rounded-full bg-cyan-200/40 blur-3xl" />
      </div>

      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-slate-200 bg-white/90 shadow-sm backdrop-blur-xl lg:block">
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-200 px-5 py-5">
            <Link href="/dashboard" className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-950/20">
                <FolderKanban className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-semibold leading-5">
                  Quản lý tài liệu
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Document Management
                </div>
              </div>
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4">
            <div className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Tổng quan
            </div>

            <nav className="space-y-1">
              <NavItem href="/dashboard" icon={<Home className="h-4 w-4" />}>
                Dashboard
              </NavItem>

              <NavItem
                href="/assignments"
                icon={<ListTodo className="h-4 w-4" />}
              >
                Việc của tôi
              </NavItem>
            </nav>

            <div className="mb-3 mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Loại tài liệu
            </div>

            <nav className="space-y-1">
              {types.map((type) => (
                <NavItem
                  key={type.code}
                  href={`/documents/${type.code}`}
                  icon={<FileText className="h-4 w-4" />}
                >
                  {type.name}
                </NavItem>
              ))}
            </nav>

            {user.role === "ADMIN" && (
              <>
                <div className="mb-3 mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Quản trị
                </div>

                <nav className="space-y-1">
                  <NavItem
                    href="/admin/document-types"
                    icon={<Settings className="h-4 w-4" />}
                  >
                    Loại tài liệu
                  </NavItem>
                </nav>
              </>
            )}
          </div>

          <div className="border-t border-slate-200 p-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 ring-1 ring-slate-200">
                  <UserRound className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {user.fullName}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {user.username}
                  </div>
                </div>
              </div>

              <div
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                  roleClassName,
                )}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {roleLabel}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur-xl">
          <div className="flex h-16 items-center justify-between px-4 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white lg:hidden">
                <LayoutDashboard className="h-5 w-5" />
              </div>

              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Xin chào, {user.fullName}
                </div>
                <div className="mt-0.5 hidden text-xs text-slate-500 sm:block">
                  {user.permissions.join(", ") || "DOC_USER"}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 md:flex">
                <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                Hệ thống nội bộ
              </div>

              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                aria-label="Thông báo"
              >
                <Bell className="h-4 w-4" />
              </button>

              <LogoutButton />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function NavItem({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition",
        "hover:bg-slate-100 hover:text-slate-950",
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition group-hover:bg-white group-hover:text-slate-900">
          {icon}
        </span>
        <span className="truncate">{children}</span>
      </span>

      <ChevronRight className="h-4 w-4 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-60" />
    </Link>
  );
}

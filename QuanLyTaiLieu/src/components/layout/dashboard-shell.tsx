"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Bell,
  ChevronRight,
  FileText,
  FolderKanban,
  Home,
  LayoutDashboard,
  ListTodo,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { DocumentType, SessionUser } from "@/types/document";

export function DashboardShell({
  user,
  types,
  children,
}: {
  user: SessionUser;
  types: DocumentType[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const pageTitle = useMemo(() => {
    return getPageTitle(pathname, types);
  }, [pathname, types]);

  const pageDescription = useMemo(() => {
    return getPageDescription(pathname, types);
  }, [pathname, types]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden border-r bg-card/95 shadow-sm backdrop-blur-xl transition-all duration-300 lg:block",
          collapsed ? "w-20" : "w-72",
        )}
      >
        <div className="flex h-full flex-col">
          <SidebarBrand collapsed={collapsed} />

          <div className="flex-1 overflow-y-auto px-3 py-4">
            <SidebarGroup title="Tổng quan" collapsed={collapsed}>
              <NavItem
                href="/dashboard"
                icon={<Home className="h-4 w-4" />}
                collapsed={collapsed}
                active={pathname === "/dashboard"}
              >
                Dashboard
              </NavItem>

              <NavItem
                href="/assignments"
                icon={<ListTodo className="h-4 w-4" />}
                collapsed={collapsed}
                active={pathname.startsWith("/assignments")}
              >
                Việc của tôi
              </NavItem>
            </SidebarGroup>

            <SidebarGroup title="Loại tài liệu" collapsed={collapsed}>
              {types.map((type) => (
                <NavItem
                  key={type.code}
                  href={`/documents/${type.code}`}
                  icon={<FileText className="h-4 w-4" />}
                  collapsed={collapsed}
                  active={pathname.startsWith(`/documents/${type.code}`)}
                >
                  {type.name}
                </NavItem>
              ))}
            </SidebarGroup>

            {user.role === "ADMIN" && (
              <SidebarGroup title="Quản trị" collapsed={collapsed}>
                <NavItem
                  href="/admin/document-types"
                  icon={<Settings className="h-4 w-4" />}
                  collapsed={collapsed}
                  active={pathname.startsWith("/admin/document-types")}
                >
                  Loại tài liệu
                </NavItem>
              </SidebarGroup>
            )}
          </div>

          <SidebarBottomCollapse
            collapsed={collapsed}
            onClick={() => setCollapsed((value) => !value)}
          />
        </div>
      </aside>

      <div
        className={cn(
          "transition-all duration-300 lg:pl-72",
          collapsed && "lg:pl-20",
        )}
      >
        <header className="sticky top-0 z-20 border-b bg-card/90 backdrop-blur-xl">
          <div className="flex h-16 items-center justify-between gap-4 px-4 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-white lg:hidden">
                <LayoutDashboard className="h-5 w-5" />
              </div>

              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-foreground">
                  {pageTitle}
                </div>
                <div className="mt-0.5 hidden truncate text-xs text-muted-foreground sm:block">
                  {pageDescription}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden items-center gap-2 rounded-full border bg-secondary/60 px-3 py-1.5 text-xs font-medium text-muted-foreground md:flex">
                <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                Hệ thống nội bộ
              </div>

              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border bg-card text-muted-foreground shadow-sm transition hover:bg-secondary/60"
                title="Thông báo"
              >
                <Bell className="h-4 w-4" />
              </button>

              <UserMenu user={user} />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn(
        "flex h-20 items-center border-b px-4",
        collapsed ? "justify-center" : "justify-start",
      )}
    >
      <Link
        href="/dashboard"
        className={cn(
          "flex min-w-0 items-center gap-3",
          collapsed && "justify-center",
        )}
        title="Quản lý tài liệu"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/20">
          <FolderKanban className="h-5 w-5" />
        </div>

        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-base font-semibold leading-5">
              Quản lý tài liệu
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              Document Management
            </div>
          </div>
        )}
      </Link>
    </div>
  );
}

function SidebarGroup({
  title,
  collapsed,
  children,
}: {
  title: string;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      {!collapsed && (
        <div className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
      )}

      <nav className="space-y-1">{children}</nav>
    </div>
  );
}

function NavItem({
  href,
  icon,
  collapsed,
  active,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  collapsed: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  const label = typeof children === "string" ? children : undefined;

  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        "group flex items-center rounded-xl text-sm font-medium transition",
        collapsed
          ? "justify-center px-2 py-2.5"
          : "justify-between px-3 py-2.5",
        active
          ? "bg-primary text-white shadow-sm"
          : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex min-w-0 items-center",
          collapsed ? "justify-center" : "gap-3",
        )}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition",
            active
              ? "bg-white/10 text-white"
              : "bg-secondary text-muted-foreground group-hover:bg-card group-hover:text-foreground",
          )}
        >
          {icon}
        </span>

        {!collapsed && <span className="truncate">{children}</span>}
      </span>

      {!collapsed && (
        <ChevronRight
          className={cn(
            "h-4 w-4 transition",
            active
              ? "text-white/70"
              : "opacity-0 group-hover:translate-x-0.5 group-hover:opacity-60",
          )}
        />
      )}
    </Link>
  );
}

function SidebarBottomCollapse({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <div className="border-t px-3 py-4">
      <button
        type="button"
        onClick={onClick}
        title={collapsed ? "Mở rộng menu" : "Thu gọn menu"}
        className="flex h-10 w-full items-center justify-center rounded-xl text-muted-foreground transition hover:bg-slate-100 hover:text-foreground"
      >
        {collapsed ? (
          <PanelLeftOpen className="h-5 w-5" />
        ) : (
          <PanelLeftClose className="h-5 w-5" />
        )}
      </button>
    </div>
  );
}

function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

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
        : "border-slate-200 bg-secondary/60 text-foreground";

  async function handleLogout() {
    setLoggingOut(true);

    await fetch("/api/auth/logout", {
      method: "POST",
    });

    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-10 items-center justify-center rounded-xl border bg-card text-foreground shadow-sm transition hover:bg-secondary/60"
        title="Tài khoản"
      >
        <UserRound className="h-4 w-4" />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Đóng menu tài khoản"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />

          <div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-3xl border bg-card shadow-2xl shadow-primary/10">
            <div className="bg-gradient-to-br from-primary to-indigo-700 p-5 text-white">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                  <UserRound className="h-6 w-6" />
                </div>

                <div className="min-w-0">
                  <div className="truncate font-semibold">{user.fullName}</div>
                  <div className="mt-1 truncate text-xs text-slate-300">
                    {user.username}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4 p-4">
              <div
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                  roleClassName,
                )}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {roleLabel}
              </div>

              <div className="rounded-2xl border bg-secondary/60 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Quyền hiện tại
                </div>

                <div className="flex flex-wrap gap-2">
                  {user.permissions.map((permission) => (
                    <span
                      key={permission}
                      className="rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground"
                    >
                      {permission}
                    </span>
                  ))}
                </div>
              </div>

              <button
                type="button"
                disabled={loggingOut}
                onClick={handleLogout}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-white transition hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60"
              >
                <LogOut className="h-4 w-4" />
                {loggingOut ? "Đang đăng xuất..." : "Đăng xuất"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function getPageTitle(pathname: string, types: DocumentType[]) {
  if (pathname === "/dashboard") return "Dashboard";
  if (pathname.startsWith("/assignments")) return "Việc của tôi";
  if (pathname.startsWith("/admin/document-types")) return "Loại tài liệu";

  const documentMatch = pathname.match(/^\/documents\/([^/]+)/);

  if (documentMatch) {
    const code = decodeURIComponent(documentMatch[1]);
    const type = types.find((item) => item.code === code);

    if (pathname.endsWith("/new")) {
      return type ? `Thêm ${type.name.toLowerCase()}` : "Thêm tài liệu";
    }

    if (pathname.split("/").length >= 4) {
      return type ? `Chi tiết ${type.name.toLowerCase()}` : "Chi tiết tài liệu";
    }

    return type?.name || "Tài liệu";
  }

  return "Quản lý tài liệu";
}

function getPageDescription(pathname: string, types: DocumentType[]) {
  if (pathname === "/dashboard") return "Tổng quan hệ thống quản lý tài liệu";
  if (pathname.startsWith("/assignments"))
    return "Danh sách công việc được giao";

  if (pathname.startsWith("/admin/document-types")) {
    return "Cấu hình nhóm tài liệu và kiểu nghiệp vụ";
  }

  const documentMatch = pathname.match(/^\/documents\/([^/]+)/);

  if (documentMatch) {
    const code = decodeURIComponent(documentMatch[1]);
    const type = types.find((item) => item.code === code);

    if (type?.moduleKind === "VERSIONED_DOCUMENT") {
      return "Tài liệu có quản lý phiên bản";
    }

    if (type?.moduleKind === "ASSIGNMENT_DOCUMENT") {
      return "Tài liệu có giao người phụ trách xử lý";
    }
  }

  return "Hệ thống quản lý tài liệu nội bộ";
}

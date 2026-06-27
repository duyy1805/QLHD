import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, Home, ListTodo, Settings } from "lucide-react";
import { getSession } from "@/lib/auth";
import { listDocumentTypes } from "@/services/document-type.service";
import { cn } from "@/lib/utils";
import { LogoutButton } from "@/components/layout/logout-button";

export async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  if (!user) redirect("/login");
  const types = await listDocumentTypes(true);
  const roleLabel = user.role === "ADMIN" ? "Admin" : user.role === "TBP" ? "Trưởng bộ phận" : "Người dùng";

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 border-r bg-white lg:block">
        <div className="border-b px-5 py-4">
          <div className="text-lg font-semibold">Quản lý tài liệu</div>
          <div className="text-sm text-muted-foreground">{roleLabel}</div>
        </div>
        <nav className="space-y-1 p-3">
          <NavItem href="/dashboard" icon={<Home size={18} />}>Dashboard</NavItem>
          {types.map((type) => <NavItem key={type.code} href={`/documents/${type.code}`} icon={<FileText size={18} />}>{type.name}</NavItem>)}
          <NavItem href="/assignments" icon={<ListTodo size={18} />}>Việc của tôi</NavItem>
          {user.role === "ADMIN" && <NavItem href="/admin/document-types" icon={<Settings size={18} />}>Loại tài liệu</NavItem>}
        </nav>
      </aside>
      <div className="lg:pl-72">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-white px-4 lg:px-8">
          <div>
            <div className="font-medium">{user.fullName}</div>
            <div className="text-xs text-muted-foreground">{user.permissions.join(", ") || "DOC_USER"}</div>
          </div>
          <LogoutButton />
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function NavItem({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <Link href={href} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100")}>{icon}<span>{children}</span></Link>;
}

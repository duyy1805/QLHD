import { Fragment, useMemo } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "@/components/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import UserMenu from "@/components/UserMenu";
import { getSidebarData } from "@/components/sidebar-data";

export default function AppLayout() {
  const location = useLocation();

  // ✅ Lấy role từ localStorage
  const role = useMemo(() => localStorage.getItem("role") ?? "user", []);

  // ✅ Gọi getSidebarData dựa trên role
  const data = getSidebarData();

  // ✅ Tạo breadcrumb dựa trên pathname hiện tại
  const breadcrumbItems = useMemo(() => {
    for (const group of data.navMain) {
      for (const item of group.items) {
        if (location.pathname === item.url) {
          return [
            { title: group.title, href: null },
            { title: item.title, href: item.url },
          ];
        }
      }
    }
    return [];
  }, [location.pathname, data]);

  return (
    <SidebarProvider>
      {/* ✅ Truyền role vào AppSidebar */}
      <AppSidebar role={role} />
      <SidebarInset>
        <header className="flex h-16 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <Breadcrumb>
              <BreadcrumbList>
                {breadcrumbItems.map((item, index) => (
                  <Fragment key={item.title}>
                    <BreadcrumbItem>
                      {index === breadcrumbItems.length - 1 ? (
                        <BreadcrumbPage>{item.title}</BreadcrumbPage>
                      ) : item.href ? (
                        <BreadcrumbLink href={item.href}>
                          {item.title}
                        </BreadcrumbLink>
                      ) : (
                        item.title
                      )}
                    </BreadcrumbItem>
                    {index !== breadcrumbItems.length - 1 && (
                      <BreadcrumbSeparator />
                    )}
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          <UserMenu />
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

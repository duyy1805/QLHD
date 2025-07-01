import { Fragment } from "react";
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
import { sidebarData } from "@/components/sidebar-data";

const data = sidebarData;

const getBreadcrumbFromNav = (pathname: string) => {
  for (const group of data.navMain) {
    for (const item of group.items) {
      if (item.url === pathname) {
        return [
          { title: group.title, href: null }, // không có link cho group
          { title: item.title, href: item.url },
        ];
      }
    }
  }
  return []; // fallback nếu không tìm thấy
};

export default function AppLayout() {
  const location = useLocation();
  const breadcrumbItems = getBreadcrumbFromNav(location.pathname);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 items-center gap-2 border-b px-4">
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
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

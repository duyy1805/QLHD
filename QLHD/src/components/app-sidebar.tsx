import * as React from "react";

import { NavMain } from "@/components/nav-main";
import { NavAdmin } from "@/components/nav-admin";
import { NavProjects } from "@/components/nav-projects";
import { NavUser } from "@/components/nav-user";
import { TeamSwitcher } from "@/components/team-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { getSidebarData } from "@/components/sidebar-data"; // ✅ gọi hàm, không dùng biến tĩnh

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  role: string;
};

export function AppSidebar({ role, ...props }: AppSidebarProps) {
  const data = getSidebarData(); // ✅ gọi hàm để lấy data theo role

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        {role === "admin" && <NavAdmin items={data.navAdmin} />}
        <NavProjects projects={data.projects} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

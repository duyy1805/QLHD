import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom"; // 👈 Thêmhttps://chatgpt.com/c/686f7f44-f3f0-8005-a7e5-db3dfb1fdead
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SearchForm } from "@/components/search-form";
import { VersionSwitcher } from "@/components/version-switcher";
import { getSidebarData } from "@/components/sidebar-data";
// Đây là dữ liệu sidebar

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const location = useLocation();
  const [originalData, setOriginalData] = useState(getSidebarData(null));
  const [filteredData, setFilteredData] = useState(originalData);

  useEffect(() => {
    const storedRole = localStorage.getItem("role");
    const data = getSidebarData(storedRole);
    setOriginalData(data);
    setFilteredData(data); // Default is full
  }, []);

  const handleSearch = (term: string) => {
    if (!term.trim()) {
      setFilteredData(originalData);
      return;
    }

    const normalizedTerm = removeVietnameseTones(term);

    const filteredNavMain = originalData.navMain
      .map((group) => {
        const matchedItems = group.items.filter((item) =>
          removeVietnameseTones(item.title).includes(normalizedTerm)
        );

        if (matchedItems.length === 0) return null;

        return {
          ...group,
          items: matchedItems,
        };
      })
      .filter(Boolean) as typeof originalData.navMain;

    setFilteredData({
      ...originalData,
      navMain: filteredNavMain,
    });
  };

  function removeVietnameseTones(str: string) {
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // xóa dấu
      .replace(/đ/g, "d") // đ -> d
      .replace(/Đ/g, "D") // Đ -> D
      .toLowerCase(); // chuyển về chữ thường
  }

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <VersionSwitcher
          versions={filteredData.versions}
          defaultVersion={filteredData.versions[0]}
        />
        <SearchForm onSearch={handleSearch} />
      </SidebarHeader>
      <SidebarContent>
        {filteredData.navMain.map((group) => (
          <Collapsible
            key={group.title}
            title={group.title}
            defaultOpen
            className="group/collapsible"
          >
            <SidebarGroup key={group.title}>
              <SidebarGroupLabel
                asChild
                className="group/label text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sm"
              >
                <CollapsibleTrigger>
                  {group.title}
                  <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          isActive={location.pathname === item.url}
                        >
                          {/* <Link to={item.url}>{item.title}</Link> */}
                          <Link
                            to={item.url}
                            className="flex items-center gap-2"
                          >
                            {item.icon && (
                              <item.icon className="w-4 h-4 text-muted-foreground" />
                            )}
                            {item.title}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

import { useEffect, useState, useRef } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

const STORAGE_KEY = "sidebarOpenItems1";

type NavItem = {
  title: string;
  url: string;
  icon?: LucideIcon;
  items?: {
    title: string;
    url: string;
  }[];
};

export function NavAdmin({ items }: { items: NavItem[] }) {
  const [openItems, setOpenItems] = useState<string[]>([]);
  const hasInitialized = useRef(false); // ✅ Chặn init lại nhiều lần

  // Load trạng thái từ localStorage chỉ 1 lần duy nhất khi items sẵn sàng
  useEffect(() => {
    if (!hasInitialized.current && items && items.length > 0) {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          console.log("🚀 Stored open items:", parsed);
          if (Array.isArray(parsed)) {
            setOpenItems(parsed);
          }
        } catch (err) {
          console.error("Lỗi parse localStorage:", err);
        }
      }
      hasInitialized.current = true; // ✅ Đánh dấu đã init
    }
  }, [items]);

  // Lưu mỗi khi openItems thay đổi
  useEffect(() => {
    if (hasInitialized.current) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(openItems));
    }
  }, [openItems]);

  const handleToggle = (title: string) => {
    setOpenItems((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    );
  };

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Admin</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const isOpen = openItems.includes(item.title);
          return (
            <Collapsible
              key={item.title}
              open={isOpen}
              onOpenChange={() => handleToggle(item.title)}
              asChild
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title}>
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items?.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton asChild>
                          <a href={subItem.url}>
                            <span>{subItem.title}</span>
                          </a>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

// sidebarData.ts
import { FileText, Settings } from "lucide-react";
export const getSidebarData = (role: string | null) => {
  const navMain = [
    {
      title: "Quản lý hợp đồng",
      icon: FileText,
      items: [
        { title: "Hợp đồng", url: "/hopdong", icon: FileText },
        { title: "Văn bản đi", url: "/vanbandi", icon: FileText },
      ],
    },
  ];

  if (role === "admin") {
    navMain.push({
      title: "Admin",
      icon: Settings,
      items: [
        // { title: "Dashboard", url: "/dashboard" },
        { title: "Quản lý danh mục", url: "/lookup", icon: Settings },
      ],
    });
  }

  return {
    versions: ["1.0.1", "1.1.0-alpha", "2.0.0-beta1"],
    navMain,
  };
};

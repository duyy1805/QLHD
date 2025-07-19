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
      title: "Quản lý danh mục",
      icon: Settings,
      items: [
        { title: "Hợp đồng", url: "/lookup/hopdong", icon: FileText },
        { title: "Văn bản đi", url: "/lookup/vanbandi", icon: FileText },
      ],
    });
  }

  return {
    versions: ["1.0.1", "1.1.0-alpha", "2.0.0-beta1"],
    navMain,
  };
};

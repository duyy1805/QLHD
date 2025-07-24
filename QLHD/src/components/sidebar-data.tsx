import {
  AudioWaveform,
  Command,
  Frame,
  GalleryVerticalEnd,
  Map,
  PieChart,
  SquareTerminal,
  BookOpen,
} from "lucide-react";

export const getSidebarData = () => {
  const navMain = [
    {
      title: "Văn bản, tài liệu",
      url: "#",
      icon: BookOpen,
      items: [
        { title: "Hợp đồng", url: "/document/hopdong" },
        { title: "Văn bản đi", url: "/document/vanbandi" },
        { title: "Hồ sơ thanh toán", url: "/document/hosothanhtoan" },
      ],
    },
  ];

  const navAdmin = [
    {
      title: "Danh mục",
      url: "#",
      icon: SquareTerminal,
      items: [
        { title: "Hợp đồng", url: "/lookup/hopdong" },
        { title: "Văn bản đi", url: "/lookup/vanbandi" },
        { title: "Hồ sơ thanh toán", url: "/lookup/hosothanhtoan" },
      ],
    },
  ];

  return {
    user: {
      name: "shadcn",
      email: "m@example.com",
      avatar: "/avatars/shadcn.jpg",
    },
    teams: [
      {
        name: "Acme Inc",
        logo: GalleryVerticalEnd,
        plan: "Enterprise",
      },
      {
        name: "Acme Corp.",
        logo: AudioWaveform,
        plan: "Startup",
      },
      {
        name: "Evil Corp.",
        logo: Command,
        plan: "Free",
      },
    ],
    navMain,
    navAdmin,
    projects: [
      {
        name: "Design Engineering",
        url: "#",
        icon: Frame,
      },
      {
        name: "Sales & Marketing",
        url: "#",
        icon: PieChart,
      },
      {
        name: "Travel",
        url: "#",
        icon: Map,
      },
    ],
  };
};

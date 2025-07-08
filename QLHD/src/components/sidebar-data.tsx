// sidebarData.ts
export const getSidebarData = (role: string | null) => {
  const navMain = [
    {
      title: "Quản lý hợp đồng",
      items: [{ title: "Hợp đồng", url: "/hopdong" }],
    },
  ];

  if (role === "admin") {
    navMain.push({
      title: "Admin",
      items: [
        { title: "Dashboard", url: "/dashboard" },
        { title: "Quản lý danh mục", url: "/lookup" },
      ],
    });
  }

  return {
    versions: ["1.0.1", "1.1.0-alpha", "2.0.0-beta1"],
    navMain,
  };
};

"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button variant="outline" size="sm" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); }}>
      <LogOut size={16} /> Đăng xuất
    </Button>
  );
}

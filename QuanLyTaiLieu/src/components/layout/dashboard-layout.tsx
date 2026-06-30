import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getSession } from "@/lib/auth";
import { listDocumentTypes } from "@/services/document-type.service";

export async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();

  if (!user) {
    redirect("/login");
  }

  const types = await listDocumentTypes(true);

  return (
    <DashboardShell user={user} types={types}>
      {children}
    </DashboardShell>
  );
}

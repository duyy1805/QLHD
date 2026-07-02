import { notFound } from "next/navigation";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DocumentDetailView } from "@/components/documents/document-detail-view";
import { getDocument } from "@/services/document.service";
import { getSession } from "@/lib/auth";

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { id } = await params;

  const doc = await getDocument(Number(id));
  const user = await getSession();

  if (!doc) notFound();

  return (
    <DashboardLayout>
      <DocumentDetailView doc={doc} viewer={user ? { userId: user.userId, role: user.role, permissions: user.permissions } : null} />
    </DashboardLayout>
  );
}

import { notFound } from "next/navigation";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DocumentDetailView } from "@/components/documents/document-detail-view";
import { getDocument } from "@/services/document.service";

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { id } = await params;

  const doc = await getDocument(Number(id));

  if (!doc) notFound();

  return (
    <DashboardLayout>
      <DocumentDetailView doc={doc} />
    </DashboardLayout>
  );
}

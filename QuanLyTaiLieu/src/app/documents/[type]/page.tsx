import { notFound } from "next/navigation";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DocumentListView } from "@/components/documents/document-list-view";
import { getDocumentTypeByCode } from "@/services/document-type.service";
import { listDocuments } from "@/services/document.service";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: { type: string };
  searchParams?: {
    q?: string;
    status?: string;
  };
}) {
  const docType = await getDocumentTypeByCode(params.type);

  if (!docType) {
    notFound();
  }

  const documents = await listDocuments(
    docType.code,
    searchParams?.q,
    searchParams?.status,
  );

  return (
    <DashboardLayout>
      <DocumentListView
        type={docType}
        documents={documents}
        query={searchParams?.q || ""}
        status={searchParams?.status || ""}
      />
    </DashboardLayout>
  );
}

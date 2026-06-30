import { notFound } from "next/navigation";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DocumentListView } from "@/components/documents/document-list-view";
import { getDocumentTypeByCode } from "@/services/document-type.service";
import { listDocuments } from "@/services/document.service";

export const dynamic = "force-dynamic";

type DocumentsPageProps = {
  params: Promise<{
    type: string;
  }>;
  searchParams?: Promise<{
    q?: string;
    status?: string;
  }>;
};

export default async function DocumentsPage({
  params,
  searchParams,
}: DocumentsPageProps) {
  const { type } = await params;
  const resolvedSearchParams = await searchParams;

  const query = resolvedSearchParams?.q || "";
  const status = resolvedSearchParams?.status || "";

  const docType = await getDocumentTypeByCode(type);

  if (!docType) {
    notFound();
  }

  const documents = await listDocuments(docType.code, query, status);

  return (
    <DashboardLayout>
      <DocumentListView
        type={docType}
        documents={documents}
        query={query}
        status={status}
      />
    </DashboardLayout>
  );
}

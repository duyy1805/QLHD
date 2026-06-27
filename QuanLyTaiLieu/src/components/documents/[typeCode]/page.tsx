import { notFound } from "next/navigation";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import {
  DocumentTable,
  NewDocumentButton,
} from "@/components/documents/document-table";
import { getDocumentTypeByCode } from "@/services/document-type.service";
import { listDocuments } from "@/services/document.service";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: { type: string };
  searchParams?: { q?: string; status?: string };
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
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{docType.name}</h1>
            <p className="text-sm text-muted-foreground">
              {docType.moduleKind}
            </p>
          </div>

          <NewDocumentButton typeCode={docType.code} />
        </div>

        <DocumentTable
          documents={documents}
          typeCode={docType.code}
          moduleKind={docType.moduleKind}
        />
      </div>
    </DashboardLayout>
  );
}

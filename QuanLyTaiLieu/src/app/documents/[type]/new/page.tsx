import { notFound } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DocumentForm } from "@/components/documents/document-form";
import { getDocumentTypeByCode } from "@/services/document-type.service";
import { listTagUsers } from "@/services/user.service";

export default async function NewDocumentPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const docType = await getDocumentTypeByCode(type);
  if (!docType) notFound();
  const users = await listTagUsers();
  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* <div>
          <h1 className="text-2xl font-semibold">Thêm {docType.name}</h1>
          <p className="text-sm text-muted-foreground">
            Mọi người dùng đăng nhập đều có thể upload tài liệu.
          </p>
        </div> */}
        <DocumentForm type={docType} users={users} />
      </div>
    </DashboardLayout>
  );
}

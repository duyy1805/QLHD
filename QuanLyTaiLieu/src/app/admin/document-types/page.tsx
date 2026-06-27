import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { getSession } from "@/lib/auth";
import { listDocumentTypes } from "@/services/document-type.service";
import { DocumentTypeForm, DocumentTypeList } from "@/components/admin/document-type-form";

export default async function AdminDocumentTypesPage() {
  const user = await getSession();
  if (user?.role !== "ADMIN") redirect("/dashboard");
  const types = await listDocumentTypes(false);
  return <DashboardLayout><div className="space-y-5"><div><h1 className="text-2xl font-semibold">Loại tài liệu</h1><p className="text-sm text-muted-foreground">Tạo thêm Công văn hoặc nhóm tài liệu mới mà không cần thêm module code riêng.</p></div><DocumentTypeForm /><DocumentTypeList types={types} /></div></DashboardLayout>;
}

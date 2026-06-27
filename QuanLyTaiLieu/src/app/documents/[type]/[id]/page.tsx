import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getDocument } from "@/services/document.service";
import { formatDate } from "@/lib/utils";
import { CompleteAssignmentButton, VersionUploadForm } from "@/components/documents/actions";

export default async function DocumentDetailPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { id } = await params;
  const doc = await getDocument(Number(id));
  if (!doc) notFound();
  return <DashboardLayout><div className="space-y-5">
    <div className="flex items-start justify-between"><div><h1 className="text-2xl font-semibold">{doc.title}</h1><p className="text-sm text-muted-foreground">{doc.typeName} - {doc.documentNo || "Chưa có số"}</p></div><Badge>{doc.status}</Badge></div>
    <div className="grid gap-5 lg:grid-cols-3"><Card className="lg:col-span-2"><CardHeader><CardTitle>Thông tin</CardTitle></CardHeader><CardContent className="space-y-3"><p>{doc.description || "Không có mô tả."}</p><div className="text-sm text-muted-foreground">Người tạo: {doc.createdByName} - {formatDate(doc.createdAt)}</div>{doc.currentFileUrl && <Button asChild><a href={doc.currentFileUrl} target="_blank">Tải file hiện hành</a></Button>}</CardContent></Card><Card><CardHeader><CardTitle>Upload phiên bản</CardTitle></CardHeader><CardContent><VersionUploadForm documentId={doc.id} /></CardContent></Card></div>
    <Card><CardHeader><CardTitle>Lịch sử phiên bản</CardTitle></CardHeader><CardContent><div className="divide-y">{doc.versions.map((v) => <div key={v.id} className="flex items-center justify-between py-3"><div><div className="font-medium">{v.versionNo} {v.isCurrent && <Badge className="ml-2">Hiện hành</Badge>}</div><div className="text-sm text-muted-foreground">{v.fileName} - {v.uploadedByName} - {formatDate(v.uploadedAt)}</div></div><Button asChild variant="outline" size="sm"><a href={v.fileUrl} target="_blank">Download</a></Button></div>)}</div></CardContent></Card>
    <Card><CardHeader><CardTitle>Danh sách xử lý</CardTitle></CardHeader><CardContent><div className="divide-y">{doc.assignments.map((a) => <div key={a.id} className="flex items-center justify-between py-3"><div><div className="font-medium">{a.assignedToName || (a.requiredRoleCode === "DOC_TBP" ? "Trưởng bộ phận" : a.requiredRoleCode)}</div><div className="text-sm text-muted-foreground">Hạn: {formatDate(a.dueDate)} - {a.status}</div></div>{a.status !== "COMPLETED" && <CompleteAssignmentButton assignmentId={a.id} />}</div>)}{!doc.assignments.length && <div className="text-sm text-muted-foreground">Không có giao xử lý.</div>}</div></CardContent></Card>
    <Card><CardHeader><CardTitle>Lịch sử thao tác</CardTitle></CardHeader><CardContent><div className="divide-y">{doc.logs.map((l) => <div key={l.id} className="py-3 text-sm"><div className="font-medium">{l.action}</div><div className="text-muted-foreground">{l.createdByName} - {formatDate(l.createdAt)}</div></div>)}</div></CardContent></Card>
    <Button asChild variant="outline"><Link href={`/documents/${doc.typeCode}`}>Quay lại</Link></Button>
  </div></DashboardLayout>;
}

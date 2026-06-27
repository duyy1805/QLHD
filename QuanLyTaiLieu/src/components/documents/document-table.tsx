import Link from "next/link";
import { Download, Eye, Plus } from "lucide-react";
import type { DocumentListItem } from "@/types/document";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

export function DocumentTable({ documents, typeCode, moduleKind }: { documents: DocumentListItem[]; typeCode: string; moduleKind?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <Table>
        <thead className="bg-slate-50"><tr><Th>Tên tài liệu</Th><Th>Số</Th><Th>Trạng thái</Th><Th>Người tạo</Th><Th>Ngày tạo</Th>{moduleKind === "VERSIONED_DOCUMENT" ? <Th>Phiên bản</Th> : <Th>Xử lý</Th>}<Th></Th></tr></thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} className="border-t">
              <Td className="font-medium">{doc.title}</Td>
              <Td>{doc.documentNo || "-"}</Td>
              <Td><Badge>{doc.status}</Badge></Td>
              <Td>{doc.createdByName || doc.createdByUserId}</Td>
              <Td>{formatDate(doc.createdAt)}</Td>
              <Td>{doc.moduleKind === "VERSIONED_DOCUMENT" ? (doc.currentVersionNo || "-") : `${doc.completedAssignmentCount}/${doc.assignmentCount}`}</Td>
              <Td className="text-right">
                <div className="flex justify-end gap-2">
                  {doc.currentFileUrl && <Button asChild variant="outline" size="icon"><a href={doc.currentFileUrl} target="_blank"><Download size={16} /></a></Button>}
                  <Button asChild variant="outline" size="icon"><Link href={`/documents/${typeCode}/${doc.id}`}><Eye size={16} /></Link></Button>
                </div>
              </Td>
            </tr>
          ))}
          {!documents.length && <tr><Td colSpan={7} className="py-10 text-center text-muted-foreground">Chưa có tài liệu.</Td></tr>}
        </tbody>
      </Table>
    </div>
  );
}

export function NewDocumentButton({ typeCode }: { typeCode: string }) {
  return <Button asChild><Link href={`/documents/${typeCode}/new`}><Plus size={16} /> Thêm tài liệu</Link></Button>;
}

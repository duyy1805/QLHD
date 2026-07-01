import Link from "next/link";
import {
  Download,
  FileSearch,
  FileText,
  FolderKanban,
  Plus,
} from "lucide-react";

import { DocumentFilterBar } from "@/components/documents/document-filter-bar";
import { DocumentFileDialog } from "@/components/documents/document-file-dialog";
import { DeleteDocumentButton } from "@/components/documents/actions";
import { formatDate } from "@/lib/utils";
import type { AppRole, DocumentListItem, DocumentType } from "@/types/document";

type DeleteViewer = { userId: number; role: AppRole };

export function DocumentListView({
  type,
  documents,
  query,
  status,
  viewer,
}: {
  type: DocumentType;
  documents: DocumentListItem[];
  query?: string;
  status?: string;
  viewer: DeleteViewer | null;
}) {
  const isVersioned = type.moduleKind === "VERSIONED_DOCUMENT";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={
              isVersioned
                ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"
                : "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"
            }
          >
            {isVersioned ? (
              <FolderKanban className="h-5 w-5" />
            ) : (
              <FileText className="h-5 w-5" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
                {type.name}
              </h1>

              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {documents.length} tài liệu
              </span>

              <span
                className={
                  isVersioned
                    ? "rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
                    : "rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
                }
              >
                {isVersioned ? "Có phiên bản" : "Có xử lý"}
              </span>
            </div>

            <p className="mt-1 truncate text-sm text-slate-500">
              {type.description ||
                (isVersioned
                  ? "Quản lý danh sách quy trình và phiên bản hiện hành."
                  : "Quản lý danh sách thông báo, công văn và tiến độ xử lý.")}
            </p>
          </div>
        </div>

        <Link
          href={`/documents/${type.code}/new`}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Thêm tài liệu
        </Link>
      </div>

      <DocumentFilterBar typeCode={type.code} query={query} status={status} />

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Danh sách {type.name.toLowerCase()}
            </h2>

            <p className="mt-0.5 text-xs text-slate-500">
              Theo dõi, xem file, tải file và mở chi tiết tài liệu.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1240px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Tên tài liệu</th>
                <th className="px-5 py-3">Mô tả</th>
                <th className="px-5 py-3">Số</th>
                <th className="px-5 py-3">Người tạo</th>
                <th className="px-5 py-3">Ngày tạo</th>

                {isVersioned ? (
                  <th className="px-5 py-3">Phiên bản</th>
                ) : (
                  <>
                    <th className="px-5 py-3">Xử lý</th>
                    <th className="px-5 py-3">Hạn gần nhất</th>
                  </>
                )}

                <th className="w-[440px] px-5 py-3 text-right">Thao tác</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {documents.map((doc) => (
                <DocumentTableRow
                  key={doc.id}
                  document={doc}
                  typeCode={type.code}
                  isVersioned={isVersioned}
                  viewer={viewer}
                />
              ))}

              {documents.length === 0 && (
                <tr>
                  <td
                    colSpan={isVersioned ? 7 : 8}
                    className="px-5 py-16 text-center"
                  >
                    <div className="mx-auto flex max-w-sm flex-col items-center">
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                        <FileSearch className="h-7 w-7" />
                      </div>

                      <div className="font-semibold text-foreground">
                        Không có tài liệu
                      </div>

                      <p className="mt-1 text-sm text-slate-500">
                        Không tìm thấy tài liệu phù hợp với bộ lọc hiện tại.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DocumentTableRow({
  document,
  typeCode,
  isVersioned,
  viewer,
}: {
  document: DocumentListItem;
  typeCode: string;
  isVersioned: boolean;
  viewer: DeleteViewer | null;
}) {
  const assignmentCount = document.assignmentCount || 0;
  const completedCount = document.completedAssignmentCount || 0;
  const canDelete = Boolean(
    viewer &&
    (viewer.role === "ADMIN" ||
      viewer.role === "TBP" ||
      viewer.userId === document.createdByUserId),
  );

  const progress =
    assignmentCount > 0
      ? Math.round((completedCount / assignmentCount) * 100)
      : 0;

  return (
    <tr className="transition hover:bg-slate-50">
      <td className="px-5 py-4">
        <Link
          href={`/documents/${typeCode}/${document.id}`}
          className="block max-w-[320px] truncate font-semibold text-foreground transition hover:text-blue-700"
          title={document.title}
        >
          {document.title}
        </Link>
      </td>

      <td className="px-5 py-4">
        <div
          className="max-w-[360px] truncate text-slate-500"
          title={document.description || ""}
        >
          {document.description || "-"}
        </div>
      </td>

      <td className="px-5 py-4 text-slate-700">{document.documentNo || "-"}</td>

      <td className="px-5 py-4 text-slate-700">
        {document.createdByName || document.createdByUserId}
      </td>

      <td className="px-5 py-4 text-slate-700">
        {formatDate(document.createdAt)}
      </td>

      {isVersioned ? (
        <td className="px-5 py-4">
          <span className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
            {document.currentVersionNo || "-"}
          </span>
        </td>
      ) : (
        <>
          <td className="px-5 py-4">
            <div className="min-w-32">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-slate-500">
                  {completedCount}/{assignmentCount}
                </span>

                <span className="font-semibold text-slate-700">
                  {progress}%
                </span>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </td>

          <td className="px-5 py-4 text-slate-700">
            {document.nearestDueDate
              ? formatDate(document.nearestDueDate)
              : "-"}
          </td>
        </>
      )}

      <td className="w-[440px] px-5 py-4">
        <div className="flex flex-nowrap justify-end gap-2">
          {document.currentFileUrl && (
            <>
              <DocumentFileDialog
                fileUrl={document.currentFileUrl}
                fileName={document.currentFileName || document.title}
                fileType={document.currentFileType}
                title={`Xem tài liệu: ${document.title}`}
              />

              <a
                href={document.currentFileUrl}
                download
                className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-slate-700 transition hover:bg-slate-50"
                title="Tải về"
              >
                <Download className="h-4 w-4" />
              </a>
            </>
          )}

          <Link
            href={`/documents/${typeCode}/${document.id}`}
            className="inline-flex h-9 min-w-20 shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-primary px-3 text-sm font-semibold text-white transition hover:bg-primary/90"
          >
            Chi tiết
          </Link>

          {canDelete && (
            <DeleteDocumentButton documentId={document.id} label="Xoá" />
          )}
        </div>
      </td>
    </tr>
  );
}

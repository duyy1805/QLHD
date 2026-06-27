import Link from "next/link";
import { FileSearch, FileText, FolderKanban, Plus, Search } from "lucide-react";

import { AssignmentDocumentCard } from "@/components/documents/assignment-document-card";
import { VersionedDocumentCard } from "@/components/documents/versioned-document-card";
import type { DocumentListItem, DocumentType } from "@/types/document";

export function DocumentListView({
  type,
  documents,
}: {
  type: DocumentType;
  documents: DocumentListItem[];
}) {
  const isVersioned = type.moduleKind === "VERSIONED_DOCUMENT";

  return (
    <div className="space-y-6">
      <section
        className={
          isVersioned
            ? "overflow-hidden rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-slate-50 p-6 shadow-sm"
            : "overflow-hidden rounded-3xl border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-slate-50 p-6 shadow-sm"
        }
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div
              className={
                isVersioned
                  ? "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                  : "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-lg shadow-amber-500/20"
              }
            >
              {isVersioned ? (
                <FolderKanban className="h-7 w-7" />
              ) : (
                <FileText className="h-7 w-7" />
              )}
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={
                    isVersioned
                      ? "rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                      : "rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
                  }
                >
                  {isVersioned ? "Nhóm quy trình" : "Nhóm thông báo xử lý"}
                </span>

                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                  {documents.length} tài liệu
                </span>
              </div>

              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
                {type.name}
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                {type.description ||
                  (isVersioned
                    ? "Quản lý danh sách quy trình, số quy trình và các phiên bản tài liệu."
                    : "Quản lý thông báo, công văn hoặc tài liệu có giao người phụ trách xử lý.")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="Tìm tài liệu..."
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-100 sm:w-64"
              />
            </div>

            <Link
              href={`/documents/${type.code}/new`}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              Thêm tài liệu
            </Link>
          </div>
        </div>
      </section>

      {documents.length > 0 ? (
        <div className="grid gap-5">
          {documents.map((document) =>
            document.moduleKind === "VERSIONED_DOCUMENT" ? (
              <VersionedDocumentCard key={document.id} document={document} />
            ) : (
              <AssignmentDocumentCard key={document.id} document={document} />
            ),
          )}
        </div>
      ) : (
        <EmptyDocumentState type={type} />
      )}
    </div>
  );
}

function EmptyDocumentState({ type }: { type: DocumentType }) {
  const isVersioned = type.moduleKind === "VERSIONED_DOCUMENT";

  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-400">
        <FileSearch className="h-8 w-8" />
      </div>

      <h2 className="text-lg font-semibold text-slate-950">Chưa có tài liệu</h2>

      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
        {isVersioned
          ? "Khi người dùng tải quy trình lên, danh sách phiên bản và file hiện hành sẽ hiển thị tại đây."
          : "Khi có thông báo hoặc công văn được tạo, danh sách giao xử lý sẽ hiển thị tại đây."}
      </p>

      <Link
        href={`/documents/${type.code}/new`}
        className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
      >
        <Plus className="h-4 w-4" />
        Thêm tài liệu đầu tiên
      </Link>
    </div>
  );
}

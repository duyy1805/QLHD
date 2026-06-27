import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Download,
  FileText,
  Hash,
  Layers3,
  UserRound,
} from "lucide-react";

import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import type { DocumentListItem } from "@/types/document";

export function VersionedDocumentCard({
  document,
}: {
  document: DocumentListItem;
}) {
  return (
    <Card className="group overflow-hidden rounded-3xl border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="p-0">
        <div className="border-b border-slate-100 bg-gradient-to-br from-blue-50 via-white to-slate-50 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
                <Layers3 className="h-6 w-6" />
              </div>

              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                    Quy trình
                  </span>
                  <DocumentStatusBadge status={document.status} />
                </div>

                <Link
                  href={`/documents/${document.typeCode}/${document.id}`}
                  className="line-clamp-2 text-lg font-semibold leading-6 text-slate-950 transition group-hover:text-blue-700"
                >
                  {document.title}
                </Link>

                {document.description && (
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">
                    {document.description}
                  </p>
                )}
              </div>
            </div>

            <Link
              href={`/documents/${document.typeCode}/${document.id}`}
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-700 sm:inline-flex"
              aria-label="Xem chi tiết quy trình"
            >
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <InfoItem
            icon={<Hash className="h-4 w-4" />}
            label="Số quy trình"
            value={document.documentNo || "Chưa có"}
          />

          <InfoItem
            icon={<Layers3 className="h-4 w-4" />}
            label="Phiên bản hiện tại"
            value={document.currentVersionNo || "Chưa có"}
          />

          <InfoItem
            icon={<CalendarDays className="h-4 w-4" />}
            label="Ngày tạo"
            value={formatDate(document.createdAt)}
          />

          <InfoItem
            icon={<UserRound className="h-4 w-4" />}
            label="Người tạo"
            value={document.createdByName || "Không rõ"}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-5 py-4">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <FileText className="h-4 w-4" />
            <span>{document.typeName}</span>
          </div>

          <div className="flex items-center gap-2">
            {document.currentFileUrl && (
              <Link
                href={document.currentFileUrl}
                target="_blank"
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <Download className="h-4 w-4" />
                Tải file
              </Link>
            )}

            <Link
              href={`/documents/${document.typeCode}/${document.id}`}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-950 px-3 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              Chi tiết
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </div>
      <div className="truncate text-sm font-semibold text-slate-900">
        {value}
      </div>
    </div>
  );
}

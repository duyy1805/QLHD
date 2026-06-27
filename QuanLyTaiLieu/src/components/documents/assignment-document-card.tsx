import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileClock,
  UsersRound,
} from "lucide-react";

import { DocumentStatusBadge } from "@/components/documents/document-status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import type { DocumentListItem } from "@/types/document";

export function AssignmentDocumentCard({
  document,
}: {
  document: DocumentListItem;
}) {
  const assignmentCount = document.assignmentCount || 0;
  const completedCount = document.completedAssignmentCount || 0;

  const progress =
    assignmentCount > 0
      ? Math.round((completedCount / assignmentCount) * 100)
      : 0;

  const isOverdue =
    document.nearestDueDate &&
    new Date(document.nearestDueDate).getTime() < new Date().getTime() &&
    completedCount < assignmentCount;

  return (
    <Card className="group overflow-hidden rounded-3xl border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="p-0">
        <div className="border-b border-slate-100 bg-gradient-to-br from-amber-50 via-white to-slate-50 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-amber-500 text-white shadow-lg shadow-amber-500/20">
                <FileClock className="h-7 w-7" />
              </div>

              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                    Thông báo xử lý
                  </span>

                  <DocumentStatusBadge status={document.status} />

                  {isOverdue && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Quá hạn
                    </span>
                  )}
                </div>

                <Link
                  href={`/documents/${document.typeCode}/${document.id}`}
                  className="line-clamp-2 text-xl font-semibold leading-7 text-slate-950 transition group-hover:text-amber-700"
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
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:border-amber-200 hover:text-amber-700 sm:inline-flex"
            >
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="grid gap-4 p-5 lg:grid-cols-[1fr_240px]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <InfoBox
                icon={<UsersRound className="h-4 w-4" />}
                label="Người xử lý"
                value={`${completedCount}/${assignmentCount}`}
              />

              <InfoBox
                icon={<CalendarClock className="h-4 w-4" />}
                label="Hạn gần nhất"
                value={
                  document.nearestDueDate
                    ? formatDate(document.nearestDueDate)
                    : "Chưa có"
                }
              />

              <InfoBox
                icon={<Clock3 className="h-4 w-4" />}
                label="Ngày tạo"
                value={formatDate(document.createdAt)}
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-700">
                  Tiến độ xác nhận
                </span>
                <span className="font-semibold text-slate-900">
                  {progress}%
                </span>
              </div>

              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={
                    isOverdue
                      ? "h-full rounded-full bg-red-500"
                      : "h-full rounded-full bg-emerald-500"
                  }
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ClipboardCheck className="h-4 w-4 text-slate-500" />
              Trạng thái xử lý
            </div>

            <div className="space-y-2 text-sm">
              <Row label="Đã hoàn thành" value={completedCount} />
              <Row label="Tổng giao việc" value={assignmentCount} />
              <Row
                label="Còn lại"
                value={Math.max(assignmentCount - completedCount, 0)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-5 py-4">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <CheckCircle2 className="h-4 w-4" />
            <span>{document.typeName}</span>
          </div>

          <Link
            href={`/documents/${document.typeCode}/${document.id}`}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Xem xử lý
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoBox({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </div>
      <div className="truncate text-sm font-semibold text-slate-900">
        {value}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}

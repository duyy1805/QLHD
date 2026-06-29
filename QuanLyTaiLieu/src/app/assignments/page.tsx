import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  Inbox,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth";
import { listAssignments } from "@/services/assignment.service";
import { formatDate } from "@/lib/utils";
import { CompleteAssignmentButton } from "@/components/documents/actions";
import type { DocumentAssignment } from "@/types/document";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage() {
  const user = await getSession();
  const assignments: DocumentAssignment[] = user
    ? await listAssignments(user, true)
    : [];

  const pendingCount = assignments.filter(
    (item) => item.status !== "COMPLETED",
  ).length;

  const completedCount = assignments.filter(
    (item) => item.status === "COMPLETED",
  ).length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="relative border-b border-slate-100 bg-gradient-to-br from-white via-blue-50/70 to-slate-50 px-5 py-5 sm:px-6">
            <div className="absolute inset-x-0 top-0 h-1 bg-primary" />

            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <ClipboardList className="h-6 w-6" />
                </div>

                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Công việc được giao
                  </div>

                  <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                    Danh sách xử lý
                  </h1>

                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                    Theo dõi các tài liệu, thông báo hoặc công văn cần bạn xử lý
                    và xác nhận hoàn thành.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 sm:w-auto">
                <SummaryBox
                  label="Tổng"
                  value={assignments.length}
                  icon={<FileText className="h-4 w-4" />}
                />

                <SummaryBox
                  label="Đang xử lý"
                  value={pendingCount}
                  icon={<Clock3 className="h-4 w-4" />}
                />

                <SummaryBox
                  label="Hoàn thành"
                  value={completedCount}
                  icon={<CheckCircle2 className="h-4 w-4" />}
                />
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-6">
            {assignments.length > 0 ? (
              <div className="grid gap-3">
                {assignments.map((assignment) => (
                  <AssignmentItem key={assignment.id} assignment={assignment} />
                ))}
              </div>
            ) : (
              <EmptyAssignments />
            )}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}

function AssignmentItem({ assignment }: { assignment: DocumentAssignment }) {
  const isCompleted = assignment.status === "COMPLETED";

  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
              isCompleted
                ? "bg-emerald-50 text-emerald-600"
                : "bg-amber-50 text-amber-600"
            }`}
          >
            {isCompleted ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <Clock3 className="h-5 w-5" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-slate-950">
                {assignment.documentTitle}
              </h2>

              <StatusBadge status={assignment.status} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4 text-slate-400" />
                Hạn: {formatDate(assignment.dueDate)}
              </span>

              <span className="inline-flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-slate-400" />
                Mã tài liệu: #{assignment.documentId}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="rounded-xl border-slate-200"
          >
            <Link href={`/documents/x/${assignment.documentId}`}>
              Mở
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>

          {!isCompleted && (
            <CompleteAssignmentButton assignmentId={assignment.id} />
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryBox({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm backdrop-blur">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <span className="text-primary">{icon}</span>
        {label}
      </div>

      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "COMPLETED") {
    return (
      <Badge className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-700 hover:bg-emerald-50">
        Hoàn thành
      </Badge>
    );
  }

  if (status === "OVERDUE") {
    return (
      <Badge className="rounded-full bg-red-50 px-2.5 py-0.5 text-red-700 hover:bg-red-50">
        Quá hạn
      </Badge>
    );
  }

  return (
    <Badge className="rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-700 hover:bg-amber-50">
      Đang xử lý
    </Badge>
  );
}

function EmptyAssignments() {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
        <Inbox className="h-7 w-7" />
      </div>

      <h2 className="text-base font-semibold text-slate-950">
        Không có việc cần xử lý
      </h2>

      <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
        Khi có tài liệu được giao cho bạn, danh sách xử lý sẽ hiển thị tại đây.
      </p>

      <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
        <CheckCircle2 className="h-4 w-4" />
        Mọi thứ đã hoàn tất
      </div>
    </div>
  );
}

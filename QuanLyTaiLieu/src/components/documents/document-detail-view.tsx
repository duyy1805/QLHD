import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  History,
  Layers3,
  UploadCloud,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DocumentFileDialog } from "@/components/documents/document-file-dialog";
import {
  CompleteAssignmentButton,
  DeleteDocumentButton,
  DeleteVersionButton,
  VersionUploadForm,
} from "@/components/documents/actions";
import { formatDate } from "@/lib/utils";
import type { getDocument } from "@/services/document.service";
import type { AppRole } from "@/types/document";

type DocumentDetail = NonNullable<Awaited<ReturnType<typeof getDocument>>>;
type DocumentVersion = DocumentDetail["versions"][number];
type DocumentAssignment = DocumentDetail["assignments"][number];
type DocumentLog = DocumentDetail["logs"][number];
type DeleteViewer = { userId: number; role: AppRole };

export function DocumentDetailView({
  doc,
  viewer,
}: {
  doc: DocumentDetail;
  viewer: DeleteViewer | null;
}) {
  const isVersioned = doc.moduleKind === "VERSIONED_DOCUMENT";
  const canDeleteDocument = Boolean(
    viewer &&
      (viewer.role === "ADMIN" ||
        viewer.role === "TBP" ||
        viewer.userId === doc.createdByUserId),
  );

  const currentVersion =
    doc.versions.find((version) => version.isCurrent) || doc.versions[0];

  const assignmentCount = doc.assignments.length;
  const completedCount = doc.assignments.filter(
    (assignment) => assignment.status === "COMPLETED",
  ).length;

  const progress =
    assignmentCount > 0
      ? Math.round((completedCount / assignmentCount) * 100)
      : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild variant="outline" className="w-fit rounded-2xl">
          <Link href={`/documents/${doc.typeCode}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Quay lại danh sách
          </Link>
        </Button>

        <div className="flex flex-wrap gap-2">
          {canDeleteDocument && (
            <DeleteDocumentButton
              documentId={doc.id}
              redirectTo={`/documents/${doc.typeCode}`}
              label="Xoá tài liệu"
            />
          )}

          {currentVersion?.fileUrl && (
            <>
              <DocumentFileDialog
                fileUrl={currentVersion.fileUrl}
                fileName={currentVersion.fileName || doc.title}
                fileType={currentVersion.fileType}
                title={`Xem tài liệu: ${doc.title}`}
              />

              <Button asChild variant="outline" className="rounded-2xl">
                <a href={currentVersion.fileUrl} download>
                  <Download className="mr-2 h-4 w-4" />
                  Tải file
                </a>
              </Button>
            </>
          )}
        </div>
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="relative overflow-hidden bg-gradient-to-br from-white via-blue-50/60 to-slate-50 px-6 py-7 text-slate-900">
          <div className="absolute inset-x-0 top-0 h-1 bg-primary" />
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-blue-400/10 blur-3xl" />

          <div className="relative grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  {isVersioned ? (
                    <Layers3 className="h-3.5 w-3.5" />
                  ) : (
                    <FileText className="h-3.5 w-3.5" />
                  )}
                  {doc.typeName}
                </span>

                {currentVersion?.versionNo && (
                  <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                    Phiên bản {currentVersion.versionNo}
                  </span>
                )}
              </div>

              <h1 className="max-w-4xl break-words text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                {doc.title}
              </h1>

              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <InfoItem label="Số tài liệu" value={doc.documentNo || "-"} />
                <InfoItem
                  label="Người tạo"
                  value={doc.createdByName || String(doc.createdByUserId)}
                />
                <InfoItem
                  label="Ngày tạo"
                  value={safeFormatDate(doc.createdAt)}
                />
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Mô tả
                </div>

                <p className="whitespace-pre-line text-sm leading-6 text-slate-700">
                  {doc.description || "Không có mô tả."}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileText className="h-4 w-4 text-primary" />
                File hiện hành
              </div>

              <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <FileText className="h-5 w-5" />
                  </div>

                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {currentVersion?.fileName || "Chưa có file"}
                    </div>

                    <div className="mt-1 text-xs text-slate-500">
                      {currentVersion?.uploadedAt
                        ? `Cập nhật ${safeFormatDate(currentVersion.uploadedAt)}`
                        : "Không có thông tin cập nhật"}
                    </div>
                  </div>
                </div>
              </div>

              {!isVersioned && (
                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="text-slate-500">Tiến độ xử lý</span>
                    <span className="font-semibold text-slate-900">
                      {progress}%
                    </span>
                  </div>

                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  <div className="mt-2 text-xs text-slate-500">
                    {completedCount}/{assignmentCount} việc đã hoàn thành
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {isVersioned && <UploadVersionPanel documentId={doc.id} />}

          <VersionHistoryPanel documentId={doc.id} versions={doc.versions} viewer={viewer} />

          {!isVersioned && <AssignmentPanel assignments={doc.assignments} />}

          {isVersioned && doc.assignments.length > 0 && (
            <AssignmentPanel assignments={doc.assignments} />
          )}
        </div>

        <LogPanel logs={doc.logs} />
      </section>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 truncate font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function UploadVersionPanel({ documentId }: { documentId: number }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <UploadCloud className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-foreground">
            Upload phiên bản mới
          </h2>
        </div>

        <p className="mt-1 text-sm text-slate-500">
          Tải lên file mới để thay thế phiên bản hiện hành.
        </p>
      </div>

      <div className="px-5 py-4">
        <VersionUploadForm documentId={documentId} />
      </div>
    </div>
  );
}

function VersionHistoryPanel({
  documentId,
  versions,
  viewer,
}: {
  documentId: number;
  versions: DocumentVersion[];
  viewer: DeleteViewer | null;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <Layers3 className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-foreground">Lịch sử phiên bản</h2>
        </div>

        <p className="mt-1 text-sm text-slate-500">
          Danh sách các phiên bản đã được tải lên.
        </p>
      </div>

      <div className="divide-y divide-slate-100">
        {versions.length > 0 ? (
          versions.map((version) => (
            <div
              key={version.id}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-semibold text-foreground">
                    Phiên bản {version.versionNo}
                  </div>

                  {version.isCurrent && (
                    <Badge className="rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                      Hiện hành
                    </Badge>
                  )}
                </div>

                <div className="mt-1 truncate text-sm text-slate-500">
                  {version.fileName}
                </div>

                {version.changeNote && (
                  <div className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {version.changeNote}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                  <span>
                    Người tải:{" "}
                    {version.uploadedByName || version.uploadedByUserId || "-"}
                  </span>
                  <span>Ngày tải: {safeFormatDate(version.uploadedAt)}</span>
                </div>
              </div>

              <div className="flex shrink-0 gap-2">
                <DocumentFileDialog
                  fileUrl={version.fileUrl}
                  fileName={version.fileName}
                  fileType={version.fileType}
                  title={`Xem phiên bản ${version.versionNo}`}
                />

                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                >
                  <a href={version.fileUrl} download title="Tải về">
                    <Download className="h-4 w-4" />
                  </a>
                </Button>

                {versions.length > 1 &&
                  viewer &&
                  (viewer.role === "ADMIN" ||
                    viewer.role === "TBP" ||
                    viewer.userId === version.uploadedByUserId) && (
                    <DeleteVersionButton
                      documentId={documentId}
                      versionId={version.id}
                    />
                  )}
              </div>
            </div>
          ))
        ) : (
          <EmptyBlock text="Chưa có phiên bản tài liệu." />
        )}
      </div>
    </div>
  );
}

function AssignmentPanel({
  assignments,
}: {
  assignments: DocumentAssignment[];
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <h2 className="font-semibold text-foreground">Danh sách xử lý</h2>
        </div>

        <p className="mt-1 text-sm text-slate-500">
          Theo dõi người được giao và trạng thái hoàn thành.
        </p>
      </div>

      <div className="divide-y divide-slate-100">
        {assignments.length > 0 ? (
          assignments.map((assignment) => (
            <div key={assignment.id} className="px-5 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold text-foreground">
                    <UserRound className="h-4 w-4 text-slate-400" />
                    {getAssignmentName(assignment)}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>
                      Hạn:{" "}
                      {assignment.dueDate
                        ? safeFormatDate(assignment.dueDate)
                        : "-"}
                    </span>

                    {assignment.completedAt && (
                      <span>
                        Hoàn thành: {safeFormatDate(assignment.completedAt)}
                      </span>
                    )}
                  </div>

                  {assignment.completionNote && (
                    <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      {assignment.completionNote}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <AssignmentStatusBadge status={assignment.status} />

                  {assignment.status !== "COMPLETED" &&
                    assignment.status !== "CANCELLED" && (
                      <CompleteAssignmentButton assignmentId={assignment.id} />
                    )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <EmptyBlock text="Không có giao xử lý." />
        )}
      </div>
    </div>
  );
}

function LogPanel({ logs }: { logs: DocumentLog[] }) {
  return (
    <aside className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-slate-600" />
          <h2 className="font-semibold text-foreground">Lịch sử thao tác</h2>
        </div>

        <p className="mt-1 text-sm text-slate-500">
          Các thay đổi gần đây của tài liệu.
        </p>
      </div>

      <div className="max-h-[680px] divide-y divide-slate-100 overflow-auto">
        {logs.length > 0 ? (
          logs.map((log) => (
            <div key={log.id} className="px-5 py-4">
              <div className="flex gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                  <Clock3 className="h-4 w-4" />
                </div>

                <div className="min-w-0">
                  <div className="font-semibold text-foreground">
                    {formatAction(log.action)}
                  </div>

                  <div className="mt-1 text-xs text-slate-500">
                    {log.createdByName || log.createdByUserId || "-"} ·{" "}
                    {safeFormatDate(log.createdAt)}
                  </div>

                  {log.newValue && (
                    <div className="mt-2 max-h-24 overflow-hidden rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      {log.newValue}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <EmptyBlock text="Chưa có lịch sử thao tác." />
        )}
      </div>
    </aside>
  );
}

function AssignmentStatusBadge({
  status,
}: {
  status: DocumentAssignment["status"];
}) {
  const config: Record<
    string,
    {
      label: string;
      className: string;
      icon: "check" | "clock" | "calendar";
    }
  > = {
    PENDING: {
      label: "Chờ xử lý",
      className: "border-amber-200 bg-amber-50 text-amber-700",
      icon: "clock",
    },
    IN_PROGRESS: {
      label: "Đang xử lý",
      className: "border-blue-200 bg-blue-50 text-blue-700",
      icon: "clock",
    },
    COMPLETED: {
      label: "Hoàn thành",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      icon: "check",
    },
    OVERDUE: {
      label: "Quá hạn",
      className: "border-red-200 bg-red-50 text-red-700",
      icon: "calendar",
    },
    CANCELLED: {
      label: "Đã hủy",
      className: "border-slate-200 bg-slate-50 text-slate-600",
      icon: "clock",
    },
  };

  const item =
    config[status] ||
    ({
      label: status,
      className: "border-slate-200 bg-slate-50 text-slate-600",
      icon: "clock",
    } as const);

  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${item.className}`}
    >
      {item.icon === "check" ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : item.icon === "calendar" ? (
        <CalendarClock className="h-3.5 w-3.5" />
      ) : (
        <Clock3 className="h-3.5 w-3.5" />
      )}

      {item.label}
    </span>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <FileText className="h-6 w-6" />
      </div>

      <div className="text-sm font-medium text-slate-700">{text}</div>
    </div>
  );
}

function getAssignmentName(assignment: DocumentAssignment) {
  if (assignment.assignedToName) return assignment.assignedToName;

  if (assignment.requiredRoleCode === "DOC_TBP") return "Trưởng bộ phận";
  if (assignment.requiredRoleCode === "DOC_ADMIN") return "Quản trị tài liệu";
  if (assignment.requiredRoleCode === "DOC_USER") return "Người dùng";

  return assignment.requiredRoleCode || "Chưa xác định";
}

function formatAction(action: string) {
  const map: Record<string, string> = {
    CREATE_DOCUMENT: "Tạo tài liệu",
    UPDATE_DOCUMENT: "Cập nhật thông tin",
    UPLOAD_VERSION: "Tải phiên bản mới",
    ASSIGN_USER: "Giao xử lý",
    COMPLETE_ASSIGNMENT: "Xác nhận hoàn thành",
  };

  return map[action] || action;
}

function safeFormatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  return formatDate(value);
}

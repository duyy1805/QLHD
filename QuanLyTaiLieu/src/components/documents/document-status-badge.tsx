import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Clock3,
  FileCheck2,
  PauseCircle,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { AssignmentStatus, DocumentStatus } from "@/types/document";

type BadgeTone = "slate" | "blue" | "emerald" | "amber" | "red";

const toneClassName: Record<BadgeTone, string> = {
  slate: "border-slate-200 bg-slate-50 text-slate-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-red-200 bg-red-50 text-red-700",
};

export function DocumentStatusBadge({
  status,
  className,
}: {
  status: DocumentStatus;
  className?: string;
}) {
  const config = {
    DRAFT: {
      label: "Bản nháp",
      tone: "slate" as const,
      icon: <PauseCircle className="h-3.5 w-3.5" />,
    },
    ACTIVE: {
      label: "Đang hiệu lực",
      tone: "emerald" as const,
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    },
    ARCHIVED: {
      label: "Lưu trữ",
      tone: "blue" as const,
      icon: <Archive className="h-3.5 w-3.5" />,
    },
    CANCELLED: {
      label: "Đã hủy",
      tone: "red" as const,
      icon: <XCircle className="h-3.5 w-3.5" />,
    },
  }[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        toneClassName[config.tone],
        className,
      )}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

export function AssignmentStatusBadge({
  status,
  className,
}: {
  status: AssignmentStatus;
  className?: string;
}) {
  const config = {
    PENDING: {
      label: "Chờ xử lý",
      tone: "amber" as const,
      icon: <Clock3 className="h-3.5 w-3.5" />,
    },
    IN_PROGRESS: {
      label: "Đang xử lý",
      tone: "blue" as const,
      icon: <FileCheck2 className="h-3.5 w-3.5" />,
    },
    COMPLETED: {
      label: "Hoàn thành",
      tone: "emerald" as const,
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    },
    OVERDUE: {
      label: "Quá hạn",
      tone: "red" as const,
      icon: <AlertCircle className="h-3.5 w-3.5" />,
    },
    CANCELLED: {
      label: "Đã hủy",
      tone: "slate" as const,
      icon: <XCircle className="h-3.5 w-3.5" />,
    },
  }[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        toneClassName[config.tone],
        className,
      )}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

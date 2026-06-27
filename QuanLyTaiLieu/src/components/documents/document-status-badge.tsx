import { Archive, CheckCircle2, PauseCircle, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DocumentStatus } from "@/types/document";

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
      className: "border-slate-200 bg-slate-50 text-slate-700",
      icon: <PauseCircle className="h-3.5 w-3.5" />,
    },
    ACTIVE: {
      label: "Đang hiệu lực",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    },
    ARCHIVED: {
      label: "Lưu trữ",
      className: "border-blue-200 bg-blue-50 text-blue-700",
      icon: <Archive className="h-3.5 w-3.5" />,
    },
    CANCELLED: {
      label: "Đã hủy",
      className: "border-red-200 bg-red-50 text-red-700",
      icon: <XCircle className="h-3.5 w-3.5" />,
    },
  }[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        config.className,
        className,
      )}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

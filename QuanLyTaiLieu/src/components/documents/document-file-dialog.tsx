"use client";

import { useState } from "react";
import { Download, Eye, FileText, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type DocumentFileDialogProps = {
  fileUrl: string | null;
  fileName?: string | null;
  title?: string;
};

export function DocumentFileDialog({
  fileUrl,
  fileName,
  title = "Xem tài liệu",
}: DocumentFileDialogProps) {
  const [open, setOpen] = useState(false);

  if (!fileUrl) {
    return null;
  }

  const lowerUrl = fileUrl.toLowerCase();
  const isImage =
    lowerUrl.endsWith(".png") ||
    lowerUrl.endsWith(".jpg") ||
    lowerUrl.endsWith(".jpeg") ||
    lowerUrl.endsWith(".webp");

  const isPdf = lowerUrl.endsWith(".pdf");

  const canPreview = isImage || isPdf;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        <Eye className="h-4 w-4" />
        Xem
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          <div className="absolute left-1/2 top-1/2 flex h-[88vh] w-[94vw] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                  <FileText className="h-5 w-5" />
                </div>

                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-950">
                    {title}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {fileName || fileUrl}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={fileUrl}
                  download
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" />
                  Tải về
                </a>

                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setOpen(false)}
                  className="h-9 w-9 rounded-xl"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 bg-slate-100 p-4">
              <div className="h-full overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {isPdf && (
                  <iframe
                    src={fileUrl}
                    title={title}
                    className="h-full w-full"
                  />
                )}

                {isImage && (
                  <div className="flex h-full items-center justify-center overflow-auto bg-slate-950/5 p-4">
                    <img
                      src={fileUrl}
                      alt={fileName || title}
                      className="max-h-full max-w-full rounded-xl object-contain shadow-sm"
                    />
                  </div>
                )}

                {!canPreview && (
                  <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-400">
                      <FileText className="h-8 w-8" />
                    </div>

                    <div className="text-lg font-semibold text-slate-950">
                      Không thể xem trực tiếp file này
                    </div>

                    <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                      Trình duyệt thường chỉ xem trực tiếp được PDF và hình ảnh.
                      File Word/Excel có thể cần tải về hoặc tích hợp thêm trình
                      xem Office.
                    </p>

                    <a
                      href={fileUrl}
                      download
                      className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      <Download className="h-4 w-4" />
                      Tải file
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

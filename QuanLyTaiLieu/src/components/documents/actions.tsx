"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  FileUp,
  Loader2,
  Paperclip,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function VersionUploadForm({ documentId }: { documentId: number }) {
  const router = useRouter();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function clearSelectedFile() {
    setSelectedFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleFileChange(file?: File | null) {
    if (!file) {
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  }

  function handleDrop(file: File) {
    if (!fileInputRef.current) return;

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInputRef.current.files = dataTransfer.files;

    setSelectedFile(file);
  }

  return (
    <form
      className="space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();

        const form = event.currentTarget;
        const formData = new FormData(form);

        setLoading(true);

        try {
          const res = await fetch(`/api/documents/${documentId}/versions`, {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            const data = await res.json().catch(() => null);
            toast.error(data?.message || "Upload thất bại");
            return;
          }

          toast.success("Đã upload phiên bản mới");
          form.reset();
          setSelectedFile(null);
          router.refresh();
        } catch {
          toast.error("Có lỗi xảy ra khi upload phiên bản mới");
        } finally {
          setLoading(false);
        }
      }}
    >
      <div className="grid gap-4 xl:grid-cols-[260px_1fr]">
        <div className="space-y-2">
          <label
            htmlFor="versionNo"
            className="text-sm font-semibold text-slate-700"
          >
            Số phiên bản
          </label>

          <Input
            id="versionNo"
            name="versionNo"
            placeholder="Ví dụ: v2, v3, 1.0.1"
            required
            disabled={loading}
            className="h-11 rounded-2xl border-slate-200 bg-white px-4 text-sm font-medium shadow-sm"
          />

          <p className="text-xs text-slate-500">
            Nên nhập theo quy ước: v1, v2, v3 hoặc 1.0, 1.1.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-semibold text-slate-700">
              File tài liệu
            </label>

            {selectedFile && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Đã chọn file
              </span>
            )}
          </div>

          <input
            ref={fileInputRef}
            name="file"
            type="file"
            required
            disabled={loading}
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
            onChange={(event) => {
              handleFileChange(event.target.files?.[0]);
            }}
          />

          <button
            type="button"
            disabled={loading}
            onClick={openFilePicker}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);

              const file = event.dataTransfer.files?.[0];
              if (file) handleDrop(file);
            }}
            className={
              dragOver
                ? "flex min-h-[120px] w-full flex-col items-center justify-center rounded-3xl border border-blue-300 bg-blue-50 px-5 py-6 text-center shadow-sm transition"
                : "flex min-h-[120px] w-full flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 px-5 py-6 text-center shadow-sm transition hover:border-blue-300 hover:bg-blue-50/60"
            }
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm">
              <UploadCloud className="h-6 w-6" />
            </div>

            <div className="text-sm font-semibold text-slate-900">
              Kéo thả file vào đây hoặc bấm để chọn file
            </div>

            <div className="mt-1 text-xs text-slate-500">
              Hỗ trợ PDF, Word, Excel, ảnh. Dung lượng tối đa theo cấu hình
              server.
            </div>
          </button>

          {selectedFile && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Paperclip className="h-5 w-5" />
                </div>

                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {selectedFile.name}
                  </div>

                  <div className="mt-0.5 text-xs text-slate-500">
                    {formatFileSize(selectedFile.size)}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={loading}
                onClick={clearSelectedFile}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                title="Bỏ chọn file"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="changeNote"
          className="text-sm font-semibold text-slate-700"
        >
          Ghi chú thay đổi
        </label>

        <Textarea
          id="changeNote"
          name="changeNote"
          placeholder="Ví dụ: Cập nhật biểu mẫu, bổ sung bước kiểm tra, thay đổi người phê duyệt..."
          disabled={loading}
          className="min-h-28 rounded-2xl border-slate-200 bg-white px-4 py-3 text-sm shadow-sm"
        />
      </div>

      <Button
        type="submit"
        disabled={loading}
        className="h-12 w-full rounded-2xl bg-primary text-sm font-semibold text-white shadow-sm hover:bg-primary/90"
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Đang upload...
          </>
        ) : (
          <>
            <FileUp className="mr-2 h-4 w-4" />
            Upload phiên bản mới
          </>
        )}
      </Button>
    </form>
  );
}

export function CompleteAssignmentButton({
  assignmentId,
}: {
  assignmentId: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <Button
      size="sm"
      disabled={loading}
      className="rounded-xl"
      onClick={async () => {
        const completionNote = window.prompt("Ghi chú hoàn thành", "") || "";

        setLoading(true);

        try {
          const res = await fetch(`/api/assignments/${assignmentId}/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ completionNote }),
          });

          if (!res.ok) {
            const data = await res.json().catch(() => null);
            toast.error(data?.message || "Không thể xác nhận");
            return;
          }

          toast.success("Đã xác nhận hoàn thành");
          router.refresh();
        } catch {
          toast.error("Có lỗi xảy ra khi xác nhận hoàn thành");
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Đang lưu...
        </>
      ) : (
        "Xác nhận"
      )}
    </Button>
  );
}

export function DeleteDocumentButton({
  documentId,
  redirectTo,
  label = "Xoá",
}: {
  documentId: number;
  redirectTo?: string;
  label?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);

    try {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.message || "Không thể xoá tài liệu");
        return;
      }

      toast.success("Đã xoá tài liệu");
      if (redirectTo) {
        router.push(redirectTo);
        router.refresh();
      } else {
        router.refresh();
      }
    } catch {
      toast.error("Có lỗi xảy ra khi xoá tài liệu");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={loading} className="rounded-xl text-red-600 hover:text-red-700">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          <span className="ml-2">{loading ? "Đang xoá..." : label}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xoá tài liệu?</AlertDialogTitle>
          <AlertDialogDescription>
            File trên Google Drive sẽ bị xoá thật. Thông tin tài liệu được xoá mềm trong database.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Huỷ</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={loading} onClick={handleDelete}>
            Xoá
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteVersionButton({
  documentId,
  versionId,
}: {
  documentId: number;
  versionId: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);

    try {
      const res = await fetch(`/api/documents/${documentId}/versions/${versionId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.message || "Không thể xoá phiên bản");
        return;
      }

      toast.success("Đã xoá phiên bản");
      router.refresh();
    } catch {
      toast.error("Có lỗi xảy ra khi xoá phiên bản");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={loading} className="rounded-xl text-red-600 hover:text-red-700" title="Xoá phiên bản">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xoá phiên bản?</AlertDialogTitle>
          <AlertDialogDescription>
            File của phiên bản này trên Google Drive sẽ bị xoá thật. Phiên bản được xoá mềm trong database.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Huỷ</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={loading} onClick={handleDelete}>
            Xoá
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;

  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;

  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

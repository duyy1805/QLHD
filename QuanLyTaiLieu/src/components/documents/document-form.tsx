"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarClock,
  ClipboardList,
  FileText,
  Hash,
  Layers3,
  Loader2,
  NotebookText,
  Save,
  UploadCloud,
  UserRound,
} from "lucide-react";

import type { DocumentType, TagUser } from "@/types/document";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";

export function DocumentForm({
  type,
  users,
}: {
  type: DocumentType;
  users: TagUser[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const isVersioned = type.moduleKind === "VERSIONED_DOCUMENT";
  const isAssignment = type.moduleKind === "ASSIGNMENT_DOCUMENT";

  return (
    <form
      className="relative rounded-3xl border border-slate-200 bg-white shadow-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);

        try {
          const form = new FormData(event.currentTarget);
          form.set("documentTypeId", String(type.id));

          const res = await fetch("/api/documents", {
            method: "POST",
            body: form,
          });

          if (!res.ok) {
            const data = await res.json().catch(() => null);
            toast.error(data?.message || "Không tạo được tài liệu");
            return;
          }

          toast.success("Đã tạo tài liệu");
          router.push(`/documents/${type.code}`);
          router.refresh();
        } catch {
          toast.error("Có lỗi xảy ra khi tạo tài liệu");
        } finally {
          setLoading(false);
        }
      }}
    >
      <div className="relative rounded-t-3xl border-b border-slate-100 bg-gradient-to-br from-white via-blue-50/60 to-slate-50 px-5 py-5 sm:px-6">
        <div className="absolute inset-x-0 top-0 h-1 rounded-t-3xl bg-primary" />

        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              {isVersioned ? (
                <Layers3 className="h-5 w-5" />
              ) : (
                <ClipboardList className="h-5 w-5" />
              )}
            </div>

            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Tạo tài liệu mới
              </div>

              <h2 className="mt-1 break-words text-xl font-semibold tracking-tight text-slate-950">
                {type.name}
              </h2>

              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                Điền thông tin chính, tải file và thiết lập xử lý ban đầu cho
                tài liệu.
              </p>
            </div>
          </div>

          <span className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {type.code}
          </span>
        </div>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <FormSection
          icon={<FileText className="h-5 w-5" />}
          title="Thông tin tài liệu"
          description="Các trường này giúp nhận diện và tìm kiếm tài liệu về sau."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Tên tài liệu" required icon={<FileText />}>
              <Input
                name="title"
                required
                placeholder="Nhập tên tài liệu"
                className="h-11 rounded-xl"
              />
            </Field>

            <Field label="Số tài liệu" icon={<Hash />}>
              <Input
                name="documentNo"
                placeholder="VD: QTHD-001"
                className="h-11 rounded-xl"
              />
            </Field>
          </div>

          <Field
            label="Mô tả / nội dung"
            icon={<NotebookText />}
            hint="Tóm tắt mục đích, phạm vi hoặc nội dung cần lưu ý."
          >
            <Textarea
              name="description"
              placeholder="Nhập mô tả ngắn cho tài liệu"
              className="min-h-28 rounded-xl"
            />
          </Field>
        </FormSection>

        <FormSection
          icon={<UploadCloud className="h-5 w-5" />}
          title="File và phiên bản"
          description="File tải lên sẽ trở thành phiên bản đầu tiên của tài liệu."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={isVersioned ? "Phiên bản" : "Phiên bản/file"}
              required={isVersioned}
              icon={<Layers3 />}
            >
              <Input
                name="versionNo"
                placeholder="v1"
                required={isVersioned}
                className="h-11 rounded-xl"
              />
            </Field>

            <Field label="File" required icon={<UploadCloud />}>
              <FileUploadInput name="file" required />
            </Field>
          </div>

          <Field label="Ghi chú" icon={<NotebookText />}>
            <Textarea
              name="changeNote"
              placeholder="Ghi chú thay đổi hoặc thông tin về file"
              className="min-h-24 rounded-xl"
            />
          </Field>
        </FormSection>

        {isAssignment && (
          <FormSection
            icon={<UserRound className="h-5 w-5" />}
            title="Phân công xử lý"
            description="Có thể chỉ định người thực hiện ngay khi tạo tài liệu."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Người thực hiện" icon={<UserRound />}>
                <div className="relative z-20">
                  <SearchableSelect
                    name="assignedToUserId"
                    placeholder="Chọn người thực hiện"
                    searchPlaceholder="Tìm theo tên người thực hiện"
                    emptyLabel="Không tìm thấy người phù hợp"
                    options={users.map((u) => ({
                      value: String(u.id),
                      label: `${u.fullName} - ${u.department}`,
                    }))}
                  />
                </div>
              </Field>

              <Field label="Hạn hoàn thành" icon={<CalendarClock />}>
                <Input
                  name="dueDate"
                  type="datetime-local"
                  className="h-11 rounded-xl"
                />
              </Field>
            </div>
          </FormSection>
        )}
      </div>

      <div className="flex flex-col-reverse gap-3 rounded-b-3xl border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
        <Button
          type="button"
          variant="outline"
          className="rounded-xl"
          onClick={() => router.back()}
          disabled={loading}
        >
          Hủy
        </Button>

        <Button type="submit" disabled={loading} className="rounded-xl">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang lưu...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Tạo tài liệu
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function FormSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="relative rounded-2xl border border-slate-200 bg-white">
      <div className="rounded-t-2xl border-b border-slate-100 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-primary">
            {icon}
          </div>

          <div className="min-w-0">
            <h3 className="font-semibold text-slate-950">{title}</h3>
            <p className="mt-1 text-sm leading-5 text-slate-500">
              {description}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  hint,
  icon,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-2 text-sm">
      <div className="flex min-w-0 items-center gap-2 font-medium text-slate-800">
        {icon && (
          <span className="shrink-0 text-slate-400 [&_svg]:h-4 [&_svg]:w-4">
            {icon}
          </span>
        )}

        <span className="min-w-0 truncate">
          {label}
          {required && <span className="ml-1 text-red-500">*</span>}
        </span>
      </div>

      <div className="min-w-0">{children}</div>

      {hint && <span className="text-xs leading-5 text-slate-500">{hint}</span>}
    </div>
  );
}

function FileUploadInput({
  name,
  required,
}: {
  name: string;
  required?: boolean;
}) {
  const [fileName, setFileName] = useState("");

  return (
    <label className="flex h-11 w-full min-w-0 cursor-pointer items-center overflow-hidden rounded-xl border border-slate-200 bg-white text-sm transition hover:border-primary/40 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
      <input
        name={name}
        type="file"
        required={required}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          setFileName(file?.name || "");
        }}
      />

      <span className="flex h-full shrink-0 items-center gap-2 border-r border-slate-200 bg-slate-50 px-3 font-semibold text-primary">
        <UploadCloud className="h-4 w-4" />
        <span className="hidden sm:inline">Chọn file</span>
        <span className="sm:hidden">Chọn</span>
      </span>

      <span
        className={`min-w-0 flex-1 truncate px-3 ${
          fileName ? "font-medium text-slate-800" : "text-slate-500"
        }`}
        title={fileName || "Chưa có file nào được chọn"}
      >
        {fileName || "Chưa có file nào được chọn"}
      </span>
    </label>
  );
}

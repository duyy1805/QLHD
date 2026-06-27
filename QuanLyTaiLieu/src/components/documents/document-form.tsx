"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { DocumentType, TagUser } from "@/types/document";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

export function DocumentForm({ type, users }: { type: DocumentType; users: TagUser[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <form className="grid gap-5 rounded-lg border bg-white p-5" onSubmit={async (event) => {
      event.preventDefault();
      setLoading(true);
      const form = new FormData(event.currentTarget);
      form.set("documentTypeId", String(type.id));
      const res = await fetch("/api/documents", { method: "POST", body: form });
      setLoading(false);
      if (!res.ok) { toast.error((await res.json()).message || "Không tạo được tài liệu"); return; }
      toast.success("Đã tạo tài liệu");
      router.push(`/documents/${type.code}`);
      router.refresh();
    }}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tên tài liệu"><Input name="title" required /></Field>
        <Field label="Số tài liệu"><Input name="documentNo" /></Field>
      </div>
      <Field label="Mô tả / nội dung"><Textarea name="description" /></Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={type.moduleKind === "VERSIONED_DOCUMENT" ? "Phiên bản" : "Phiên bản/file"}><Input name="versionNo" placeholder="v1" required={type.moduleKind === "VERSIONED_DOCUMENT"} /></Field>
        <Field label="File"><Input name="file" type="file" required /></Field>
      </div>
      <Field label="Ghi chú"><Textarea name="changeNote" /></Field>
      {type.moduleKind === "ASSIGNMENT_DOCUMENT" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Người thực hiện"><select name="assignedToUserId" className="h-10 rounded-md border bg-background px-3 text-sm"><option value="">Không chỉ định - TBP xác nhận</option>{users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></Field>
          <Field label="Hạn hoàn thành"><Input name="dueDate" type="datetime-local" /></Field>
        </div>
      )}
      <div><Button disabled={loading}>{loading ? "Đang lưu..." : "Tạo tài liệu"}</Button></div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-2 text-sm font-medium"><span>{label}</span>{children}</label>;
}

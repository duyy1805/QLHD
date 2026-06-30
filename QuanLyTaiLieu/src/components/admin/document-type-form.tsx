"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { DocumentType } from "@/types/document";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function DocumentTypeForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <form
      className="grid gap-3 rounded-lg border bg-white p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);
        const data = Object.fromEntries(new FormData(event.currentTarget));
        const res = await fetch("/api/document-types", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...data,
            code: String(data.code || "").toUpperCase(),
            isActive: true,
          }),
        });
        setLoading(false);
        if (!res.ok) {
          toast.error(
            (await res.json()).message || "Không lưu được loại tài liệu",
          );
          return;
        }
        toast.success("Đã lưu loại tài liệu");
        event.currentTarget.reset();
        router.refresh();
      }}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Input name="code" placeholder="CONG_VAN" required />
        <Input name="name" placeholder="Công văn" required />
        <select
          name="moduleKind"
          className="h-10 rounded-md border px-3 text-sm"
        >
          <option value="ASSIGNMENT_DOCUMENT">Giao xử lý</option>
          <option value="VERSIONED_DOCUMENT">Có phiên bản</option>
        </select>
      </div>
      <Textarea name="description" placeholder="Mô tả" />
      <Button disabled={loading}>
        {loading ? "Đang lưu..." : "Lưu loại tài liệu"}
      </Button>
    </form>
  );
}

export function DocumentTypeList({ types }: { types: DocumentType[] }) {
  return (
    <div className="grid gap-3">
      {types.map((type) => (
        <div
          key={type.id}
          className="flex items-center justify-between rounded-lg border bg-white p-4"
        >
          <div>
            <div className="font-medium">{type.name}</div>
            <div className="text-sm text-muted-foreground">
              {type.code} - {type.moduleKind}
            </div>
          </div>
          <span className="text-sm">{type.isActive ? "Đang dùng" : "Tắt"}</span>
        </div>
      ))}
    </div>
  );
}

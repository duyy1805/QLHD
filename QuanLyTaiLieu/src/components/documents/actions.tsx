"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

export function VersionUploadForm({ documentId }: { documentId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <form
      className="grid gap-3 rounded-lg border bg-white p-4"
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
          router.refresh();
        } catch {
          toast.error("Có lỗi xảy ra khi upload phiên bản mới");
        } finally {
          setLoading(false);
        }
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Input name="versionNo" placeholder="v2" required disabled={loading} />
        <Input name="file" type="file" required disabled={loading} />
      </div>

      <Textarea
        name="changeNote"
        placeholder="Ghi chú thay đổi"
        disabled={loading}
      />

      <Button disabled={loading}>
        {loading ? "Đang upload..." : "Upload phiên bản mới"}
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
      {loading ? "Đang lưu..." : "Xác nhận"}
    </Button>
  );
}

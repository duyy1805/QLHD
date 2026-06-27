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
    <form className="grid gap-3 rounded-lg border bg-white p-4" onSubmit={async (event) => {
      event.preventDefault(); setLoading(true);
      const res = await fetch(`/api/documents/${documentId}/versions`, { method: "POST", body: new FormData(event.currentTarget) });
      setLoading(false);
      if (!res.ok) { toast.error((await res.json()).message || "Upload thất bại"); return; }
      toast.success("Đã upload phiên bản mới"); router.refresh(); event.currentTarget.reset();
    }}>
      <div className="grid gap-3 md:grid-cols-2"><Input name="versionNo" placeholder="v2" required /><Input name="file" type="file" required /></div>
      <Textarea name="changeNote" placeholder="Ghi chú thay đổi" />
      <Button disabled={loading}>{loading ? "Đang upload..." : "Upload phiên bản mới"}</Button>
    </form>
  );
}

export function CompleteAssignmentButton({ assignmentId }: { assignmentId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return <Button size="sm" disabled={loading} onClick={async () => {
    const completionNote = window.prompt("Ghi chú hoàn thành", "") || "";
    setLoading(true);
    const res = await fetch(`/api/assignments/${assignmentId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completionNote }) });
    setLoading(false);
    if (!res.ok) { toast.error((await res.json()).message || "Không thể xác nhận"); return; }
    toast.success("Đã xác nhận hoàn thành"); router.refresh();
  }}>{loading ? "Đang lưu..." : "Xác nhận"}</Button>;
}

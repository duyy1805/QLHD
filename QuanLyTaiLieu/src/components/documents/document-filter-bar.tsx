"use client";

import { useRouter } from "next/navigation";
import { RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DocumentFilterBar({
  typeCode,
  query,
  status,
}: {
  typeCode: string;
  query?: string;
  status?: string;
}) {
  const router = useRouter();

  return (
    <form
      action={`/documents/${typeCode}`}
      className="rounded-3xl border bg-card p-4 shadow-sm"
    >
      <div className="grid gap-3 lg:grid-cols-[1fr_240px_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Tìm theo tên tài liệu, số tài liệu..."
            className="h-11 w-full rounded-2xl border border-input bg-card pl-10 pr-3 text-sm font-medium text-foreground shadow-sm outline-none transition placeholder:text-muted-foreground hover:bg-secondary/50 focus:bg-card focus:ring-4 focus:ring-ring/15"
          />
        </div>

        <input type="hidden" name="status" value={status || ""} />

        <Select
          value={status || "ALL"}
          onValueChange={(value) => {
            const params = new URLSearchParams();

            const searchInput =
              document.querySelector<HTMLInputElement>('input[name="q"]');

            if (searchInput?.value) {
              params.set("q", searchInput.value);
            }

            if (value !== "ALL") {
              params.set("status", value);
            }

            const queryString = params.toString();
            router.push(
              queryString
                ? `/documents/${typeCode}?${queryString}`
                : `/documents/${typeCode}`,
            );
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Tất cả trạng thái" />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="ALL">Tất cả trạng thái</SelectItem>
            <SelectItem value="DRAFT">Bản nháp</SelectItem>
            <SelectItem value="ACTIVE">Đang hiệu lực</SelectItem>
            <SelectItem value="ARCHIVED">Lưu trữ</SelectItem>
            <SelectItem value="CANCELLED">Đã hủy</SelectItem>
          </SelectContent>
        </Select>

        <Button className="h-11 rounded-2xl px-5 font-semibold">
          Lọc
        </Button>

        <button
          type="button"
          onClick={() => router.push(`/documents/${typeCode}`)}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-input bg-card px-4 text-sm font-semibold text-foreground shadow-sm transition hover:bg-secondary/60"
        >
          <RotateCcw className="h-4 w-4" />
          Xóa lọc
        </button>
      </div>
    </form>
  );
}

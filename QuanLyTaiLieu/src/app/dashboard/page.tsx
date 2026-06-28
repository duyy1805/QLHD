import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileClock,
  FileText,
  FolderKanban,
  Layers3,
  ListTodo,
  Plus,
  TrendingUp,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth";
import { dashboardStats, listDocuments } from "@/services/document.service";
import { formatDate } from "@/lib/utils";

type Stats = Awaited<ReturnType<typeof dashboardStats>>;

export const dynamic = "force-dynamic";

const emptyStats: Stats = {
  totalDocuments: 0,
  versionedDocuments: 0,
  openAssignments: 0,
  myAssignments: 0,
  overdueAssignments: 0,
};

export default async function DashboardPage() {
  const user = await getSession();
  const stats = user ? await dashboardStats(user) : emptyStats;
  const latest = await listDocuments(undefined, undefined, undefined);

  const latestItems = latest.slice(0, 8);
  const completionRate =
    stats.openAssignments + stats.myAssignments > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(
              ((stats.myAssignments || 0) /
                (stats.openAssignments + stats.myAssignments)) *
                100,
            ),
          ),
        )
      : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Hero */}
        <section className="overflow-hidden rounded-3xl border bg-gradient-to-br from-primary via-indigo-700 to-blue-700 text-white shadow-xl shadow-primary/10">
          <div className="relative px-6 py-7 sm:px-8 lg:px-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.35),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.22),transparent_35%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:44px_44px] opacity-20" />

            <div className="relative grid gap-6 lg:grid-cols-[1fr_320px] lg:items-center">
              <div>
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-cyan-100 backdrop-blur">
                  <FolderKanban className="h-3.5 w-3.5" />
                  Dashboard quản lý tài liệu
                </div>

                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Tổng quan hệ thống tài liệu
                </h1>

                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                  Theo dõi tài liệu, quy trình phiên bản, thông báo xử lý và các
                  công việc đến hạn trong cùng một màn hình.
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <Link
                    href="/assignments"
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-foreground transition hover:bg-secondary"
                  >
                    Xem việc của tôi
                    <ArrowRight className="h-4 w-4" />
                  </Link>

                  <Link
                    href="/admin/document-types"
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15"
                  >
                    <Plus className="h-4 w-4" />
                    Loại tài liệu
                  </Link>
                </div>
              </div>

              <div className="rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-200">
                      Tình trạng xử lý
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Theo số liệu hiện tại
                    </div>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-300/20 text-cyan-100">
                    <TrendingUp className="h-5 w-5" />
                  </div>
                </div>

                <div className="text-4xl font-semibold">{completionRate}%</div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-cyan-300"
                    style={{ width: `${completionRate}%` }}
                  />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-white/10 p-3">
                    <div className="text-slate-400">Đang xử lý</div>
                    <div className="mt-1 text-xl font-semibold">
                      {stats.openAssignments}
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/10 p-3">
                    <div className="text-slate-400">Việc của tôi</div>
                    <div className="mt-1 text-xl font-semibold">
                      {stats.myAssignments}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            title="Tài liệu"
            value={stats.totalDocuments}
            description="Tổng số tài liệu"
            icon={<FileText className="h-5 w-5" />}
            tone="slate"
          />
          <StatCard
            title="Quy trình"
            value={stats.versionedDocuments}
            description="Có quản lý phiên bản"
            icon={<Layers3 className="h-5 w-5" />}
            tone="blue"
          />
          <StatCard
            title="Đang xử lý"
            value={stats.openAssignments}
            description="Chưa hoàn thành"
            icon={<Clock3 className="h-5 w-5" />}
            tone="amber"
          />
          <StatCard
            title="Việc của tôi"
            value={stats.myAssignments}
            description="Được giao cho bạn"
            icon={<ListTodo className="h-5 w-5" />}
            tone="cyan"
          />
          <StatCard
            title="Quá hạn"
            value={stats.overdueAssignments}
            description="Cần ưu tiên xử lý"
            icon={<AlertTriangle className="h-5 w-5" />}
            tone="red"
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* Latest documents */}
          <Card className="overflow-hidden rounded-3xl border-slate-200 bg-white shadow-sm">
            <CardHeader className="border-b border-slate-100 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">Tài liệu mới nhất</CardTitle>
                  <p className="mt-1 text-sm text-slate-500">
                    Các tài liệu được cập nhật gần đây trong hệ thống
                  </p>
                </div>

                <Link
                  href="/dashboard"
                  className="hidden rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 sm:inline-flex"
                >
                  Xem tất cả
                </Link>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {latestItems.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {latestItems.map((doc) => (
                    <Link
                      key={doc.id}
                      href={`/documents/${doc.typeCode}`}
                      className="group flex items-center justify-between gap-4 px-6 py-4 transition hover:bg-slate-50"
                    >
                      <div className="flex min-w-0 items-center gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 transition group-hover:bg-primary group-hover:text-white">
                          {doc.moduleKind === "VERSIONED_DOCUMENT" ? (
                            <Layers3 className="h-5 w-5" />
                          ) : (
                            <FileClock className="h-5 w-5" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900">
                            {doc.title}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5">
                              {doc.typeName}
                            </span>
                            {doc.documentNo && <span>{doc.documentNo}</span>}
                            {doc.currentVersionNo && (
                              <span>Phiên bản {doc.currentVersionNo}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="hidden shrink-0 text-right sm:block">
                        <div className="text-sm text-slate-500">
                          {formatDate(doc.createdAt)}
                        </div>
                        <div className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition group-hover:text-slate-700">
                          Chi tiết
                          <ArrowRight className="h-3.5 w-3.5" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                    <FileText className="h-7 w-7" />
                  </div>
                  <div className="font-medium text-slate-900">
                    Chưa có tài liệu
                  </div>
                  <p className="mt-1 max-w-sm text-sm text-slate-500">
                    Khi người dùng tải tài liệu lên, danh sách mới nhất sẽ hiển
                    thị tại đây.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right panel */}
          <div className="space-y-6">
            <Card className="rounded-3xl border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  Gợi ý thao tác
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ActionItem
                  href="/assignments"
                  title="Kiểm tra việc được giao"
                  description="Xem các thông báo/công văn cần xác nhận hoàn thành"
                />
                <ActionItem
                  href="/dashboard"
                  title="Theo dõi tài liệu mới"
                  description="Kiểm tra các tài liệu vừa được cập nhật"
                />
                <ActionItem
                  href="/admin/document-types"
                  title="Quản lý loại tài liệu"
                  description="Dành cho admin cấu hình thêm nhóm tài liệu"
                />
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-3xl border-slate-200 bg-white shadow-sm">
              <CardContent className="p-0">
                <div className="bg-gradient-to-br from-primary to-indigo-700 p-6 text-white">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
                    <FolderKanban className="h-6 w-6" />
                  </div>
                  <div className="text-lg font-semibold">Quản lý tập trung</div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Quy trình, thông báo, công văn và các loại tài liệu mở rộng
                    được quản lý thống nhất theo phân quyền.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}

function StatCard({
  title,
  value,
  description,
  icon,
  tone,
}: {
  title: string;
  value: number;
  description: string;
  icon: React.ReactNode;
  tone: "slate" | "blue" | "amber" | "cyan" | "red";
}) {
  const toneClassName = {
    slate: "bg-slate-100 text-slate-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    cyan: "bg-cyan-50 text-cyan-700",
    red: "bg-red-50 text-red-700",
  }[tone];

  return (
    <Card className="group rounded-3xl border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-500">{title}</div>
            <div className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
              {value}
            </div>
          </div>

          <div
            className={`flex h-11 w-11 items-center justify-center rounded-2xl ${toneClassName}`}
          >
            {icon}
          </div>
        </div>

        <div className="mt-4 text-sm text-slate-500">{description}</div>
      </CardContent>
    </Card>
  );
}

function ActionItem({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300 hover:bg-white hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-slate-900">{title}</div>
          <div className="mt-1 text-sm leading-5 text-slate-500">
            {description}
          </div>
        </div>

        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700" />
      </div>
    </Link>
  );
}

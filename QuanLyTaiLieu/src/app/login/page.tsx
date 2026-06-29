import { redirect } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  FileClock,
  FolderKanban,
  ShieldCheck,
} from "lucide-react";

import { getSession } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage() {
  const user = await getSession();
  if (user) redirect("/dashboard");

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.35),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.22),transparent_34%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:56px_56px] opacity-20" />
      <div className="absolute -left-24 top-24 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
      <div className="absolute -right-24 bottom-24 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />

      <section className="relative z-10 mx-auto grid min-h-screen w-full max-w-7xl items-center gap-10 px-4 py-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
        <div className="hidden lg:block">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-slate-200 shadow-sm backdrop-blur">
            <ShieldCheck className="h-4 w-4 text-cyan-300" />
            Hệ thống quản lý tài liệu nội bộ
          </div>

          <div className="max-w-2xl">
            <h1 className="text-5xl font-semibold tracking-tight text-white xl:text-6xl">
              Quản lý tài liệu,
              <span className="mt-2 block bg-gradient-to-r from-cyan-200 to-blue-300 bg-clip-text text-transparent">
                quy trình và công việc xử lý
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
              Tập trung hóa tài liệu nội bộ, theo dõi phiên bản quy trình, giao
              người phụ trách và kiểm soát tiến độ hoàn thành trên cùng một hệ
              thống.
            </p>
          </div>

          <div className="mt-10 grid max-w-2xl gap-4 sm:grid-cols-3">
            <FeatureCard
              icon={<FileCheck2 className="h-5 w-5" />}
              title="Quy trình"
              description="Theo dõi phiên bản mới nhất"
            />
            <FeatureCard
              icon={<FileClock className="h-5 w-5" />}
              title="Thông báo"
              description="Giao việc và hạn xử lý"
            />
            <FeatureCard
              icon={<FolderKanban className="h-5 w-5" />}
              title="Mở rộng"
              description="Admin tự tạo loại tài liệu"
            />
          </div>

          <div className="mt-10 flex items-center gap-3 text-sm text-slate-300">
            <CheckCircle2 className="h-5 w-5 text-emerald-300" />
            Đăng nhập để truy cập dashboard quản lý tài liệu
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>

        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
              <FileCheck2 className="h-7 w-7 text-cyan-200" />
            </div>
            <h1 className="text-2xl font-semibold text-white">
              Quản lý tài liệu
            </h1>
            <p className="mt-2 text-sm text-slate-300">Đăng nhập để tiếp tục</p>
          </div>

          <div className="rounded-3xl border border-white/20 bg-white/95 p-2 text-slate-900 shadow-2xl shadow-blue-950/40 backdrop-blur">
            <div className="rounded-[1.35rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="mb-7">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-700 text-white shadow-lg shadow-blue-700/25">
                  <FileCheck2 className="h-6 w-6" />
                </div>

                <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                  Đăng nhập
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Sử dụng tài khoản ERP để truy cập hệ thống quản lý tài liệu.
                </p>
              </div>

              <LoginForm />
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-white/60">
            © {new Date().getFullYear()} Quản lý tài liệu nội bộ
          </p>
        </div>
      </section>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 p-4 shadow-sm backdrop-blur">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-cyan-200 ring-1 ring-white/15">
        {icon}
      </div>
      <div className="font-medium text-white">{title}</div>
      <div className="mt-1 text-sm leading-5 text-slate-300">{description}</div>
    </div>
  );
}

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth";
import { dashboardStats, listDocuments } from "@/services/document.service";
import { formatDate } from "@/lib/utils";

type Stats = Awaited<ReturnType<typeof dashboardStats>>;
export const dynamic = "force-dynamic";

const emptyStats: Stats = { totalDocuments: 0, versionedDocuments: 0, openAssignments: 0, myAssignments: 0, overdueAssignments: 0 };

export default async function DashboardPage() {
  const user = await getSession();
  const stats = user ? await dashboardStats(user) : emptyStats;
  const latest = await listDocuments(undefined, undefined, undefined);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Tổng quan tài liệu và việc xử lý</p>
        </div>
        <div className="grid gap-4 md:grid-cols-5">
          <Stat title="Tài liệu" value={stats.totalDocuments} />
          <Stat title="Quy trình" value={stats.versionedDocuments} />
          <Stat title="Đang xử lý" value={stats.openAssignments} />
          <Stat title="Việc của tôi" value={stats.myAssignments} />
          <Stat title="Quá hạn" value={stats.overdueAssignments} />
        </div>
        <Card>
          <CardHeader><CardTitle>Tài liệu mới nhất</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y">
              {latest.slice(0, 8).map((doc) => (
                <div key={doc.id} className="flex justify-between py-3">
                  <div><div className="font-medium">{doc.title}</div><div className="text-sm text-muted-foreground">{doc.typeName}</div></div>
                  <div className="text-sm text-muted-foreground">{formatDate(doc.createdAt)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function Stat({ title, value }: { title: string; value: number }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{value}</div></CardContent></Card>;
}

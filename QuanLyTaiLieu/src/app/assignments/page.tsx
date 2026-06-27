import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth";
import { listAssignments } from "@/services/assignment.service";
import { formatDate } from "@/lib/utils";
import { CompleteAssignmentButton } from "@/components/documents/actions";
import type { DocumentAssignment } from "@/types/document";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage() {
  const user = await getSession();
  const assignments: DocumentAssignment[] = user ? await listAssignments(user, true) : [];

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">Việc của tôi</h1>
          <p className="text-sm text-muted-foreground">Bao gồm việc giao đích danh và việc cần trưởng bộ phận xác nhận.</p>
        </div>
        <Card>
          <CardHeader><CardTitle>Danh sách xử lý</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y">
              {assignments.map((assignment) => (
                <div key={assignment.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium">{assignment.documentTitle}</div>
                    <div className="text-sm text-muted-foreground">Hạn: {formatDate(assignment.dueDate)} <Badge>{assignment.status}</Badge></div>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm"><Link href={`/documents/x/${assignment.documentId}`}>Mở</Link></Button>
                    {assignment.status !== "COMPLETED" && <CompleteAssignmentButton assignmentId={assignment.id} />}
                  </div>
                </div>
              ))}
              {!assignments.length && <div className="py-8 text-center text-sm text-muted-foreground">Không có việc cần xử lý.</div>}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

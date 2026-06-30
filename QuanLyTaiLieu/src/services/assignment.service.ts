import { getPool, sql } from "@/lib/db";
import type { DocumentAssignment, SessionUser } from "@/types/document";

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null;
}
function num(value: unknown) { return value == null ? null : Number(value); }
function str(value: unknown) { return value == null ? null : String(value); }

function mapAssignment(row: Record<string, unknown>): DocumentAssignment {
  return {
    id: Number(row.Id),
    documentId: Number(row.DocumentId),
    documentTitle: str(row.DocumentTitle) || undefined,
    assignedToUserId: num(row.AssignedToUserId),
    assignedToName: str(row.AssignedToName),
    assignedByUserId: Number(row.AssignedByUserId),
    assignedByName: str(row.AssignedByName),
    requiredRoleCode: str(row.RequiredRoleCode) as DocumentAssignment["requiredRoleCode"],
    dueDate: iso(row.DueDate),
    status: String(row.Status) as DocumentAssignment["status"],
    completedByUserId: num(row.CompletedByUserId),
    completedByName: str(row.CompletedByName),
    completedAt: iso(row.CompletedAt),
    completionNote: str(row.CompletionNote),
    assignedAt: iso(row.AssignedAt) || "",
  };
}

export async function listAssignments(user: SessionUser, mineOnly = false): Promise<DocumentAssignment[]> {
  const pool = await getPool();
  const rs = await pool.request()
    .input("UserId", sql.Int, user.userId)
    .input("MineOnly", sql.Bit, mineOnly ? 1 : 0)
    .execute("doc.sp_Assignment_List");
  return ((rs.recordset || []) as Record<string, unknown>[]).map(mapAssignment);
}

export async function createAssignment(documentId: number, assignedToUserId: number | null, dueDate: string | null, user: SessionUser) {
  const pool = await getPool();
  await pool.request()
    .input("DocumentId", sql.Int, documentId)
    .input("AssignedToUserId", sql.Int, assignedToUserId)
    .input("DueDate", sql.DateTime2, dueDate ? new Date(dueDate) : null)
    .input("AssignedByUserId", sql.Int, user.userId)
    .execute("doc.sp_Assignment_Create");
}

export async function completeAssignment(id: number, note: string | null, user: SessionUser) {
  const pool = await getPool();
  await pool.request()
    .input("Id", sql.Int, id)
    .input("CompletionNote", sql.NVarChar(1000), note || null)
    .input("CompletedByUserId", sql.Int, user.userId)
    .input("IsAdmin", sql.Bit, user.role === "ADMIN" ? 1 : 0)
    .execute("doc.sp_Assignment_Complete");
}

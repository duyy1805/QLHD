import { getPool } from "@/lib/db";
import type { TagUser } from "@/types/document";

export async function listTagUsers(): Promise<TagUser[]> {
  const pool = await getPool();
  const rs = await pool.request().execute("doc.sp_User_List");
  return ((rs.recordset || []) as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    username: String(row.username),
    fullName: String(row.fullName),
    department: String(row.department || null),
  }));
}

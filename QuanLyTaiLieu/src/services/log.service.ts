import { getPool, sql } from "@/lib/db";

export async function logDocument(documentId: number, action: string, userId: number, oldValue?: unknown, newValue?: unknown) {
  const pool = await getPool();
  await pool.request()
    .input("DocumentId", sql.Int, documentId)
    .input("Action", sql.NVarChar(80), action)
    .input("OldValue", sql.NVarChar(sql.MAX), oldValue == null ? null : JSON.stringify(oldValue))
    .input("NewValue", sql.NVarChar(sql.MAX), newValue == null ? null : JSON.stringify(newValue))
    .input("CreatedByUserId", sql.Int, userId)
    .execute("doc.sp_Log_Create");
}

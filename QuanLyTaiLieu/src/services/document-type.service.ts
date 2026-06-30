import { getPool, sql } from "@/lib/db";
import type { DocumentType, ModuleKind } from "@/types/document";
import type { DocumentTypeInput } from "@/schemas/document-type.schema";

function mapType(row: Record<string, unknown>): DocumentType {
  return {
    id: Number(row.Id),
    code: String(row.Code),
    name: String(row.Name),
    moduleKind: String(row.ModuleKind) as ModuleKind,
    description: row.Description == null ? null : String(row.Description),
    isActive: Boolean(row.IsActive),
  };
}

export async function listDocumentTypes(activeOnly = false): Promise<DocumentType[]> {
  const pool = await getPool();
  const rs = await pool.request()
    .input("ActiveOnly", sql.Bit, activeOnly ? 1 : 0)
    .execute("doc.sp_DocumentType_List");
  return ((rs.recordset || []) as Record<string, unknown>[]).map(mapType);
}

export async function getDocumentTypeByCode(code: string): Promise<DocumentType | null> {
  const pool = await getPool();
  const rs = await pool.request()
    .input("Code", sql.NVarChar(50), code.toUpperCase())
    .execute("doc.sp_DocumentType_GetByCode");
  return rs.recordset?.[0] ? mapType(rs.recordset[0] as Record<string, unknown>) : null;
}

export async function upsertDocumentType(input: DocumentTypeInput): Promise<DocumentType> {
  const pool = await getPool();
  const rs = await pool.request()
    .input("Code", sql.NVarChar(50), input.code.toUpperCase())
    .input("Name", sql.NVarChar(250), input.name)
    .input("ModuleKind", sql.NVarChar(50), input.moduleKind)
    .input("Description", sql.NVarChar(1000), input.description || null)
    .input("IsActive", sql.Bit, input.isActive === false ? 0 : 1)
    .execute("doc.sp_DocumentType_Upsert");
  return mapType(rs.recordset[0] as Record<string, unknown>);
}

export async function setDocumentTypeActive(id: number, isActive: boolean) {
  const pool = await getPool();
  await pool.request()
    .input("Id", sql.Int, id)
    .input("IsActive", sql.Bit, isActive ? 1 : 0)
    .execute("doc.sp_DocumentType_SetActive");
}

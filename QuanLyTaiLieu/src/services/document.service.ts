import type { SavedFile } from "@/lib/upload";
import { getPool, sql } from "@/lib/db";
import { deleteDriveFileByPath } from "@/lib/google-drive";
import type { CreateDocumentInput, UpdateDocumentInput } from "@/schemas/document.schema";
import type { DocumentAssignment, DocumentAssignmentFile, DocumentDetail, DocumentListItem, DocumentLog, DocumentVersion, SessionUser } from "@/types/document";

function dateValue(value: unknown) {
  return value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null;
}

function text(value: unknown) { return value == null ? null : String(value); }
function num(value: unknown) { return value == null ? null : Number(value); }

type DeleteFileRow = {
  Id: number;
  FilePath: string | null;
};

function isPrivileged(user: SessionUser) {
  return user.role === "ADMIN" || user.role === "TBP";
}

async function deleteDriveFiles(rows: DeleteFileRow[]) {
  const uniquePaths = Array.from(new Set(rows.map((row) => text(row.FilePath)).filter(Boolean)));

  for (const filePath of uniquePaths) {
    await deleteDriveFileByPath(filePath);
  }
}

function mapList(row: Record<string, unknown>): DocumentListItem {
  return {
    id: Number(row.Id),
    documentTypeId: Number(row.DocumentTypeId),
    typeCode: String(row.TypeCode),
    typeName: String(row.TypeName),
    moduleKind: String(row.ModuleKind) as DocumentListItem["moduleKind"],
    title: String(row.Title),
    documentNo: text(row.DocumentNo),
    description: text(row.Description),
    status: String(row.Status) as DocumentListItem["status"],
    createdByUserId: Number(row.CreatedByUserId),
    createdByName: text(row.CreatedByName),
    createdAt: dateValue(row.CreatedAt) || "",
    currentVersionNo: text(row.CurrentVersionNo),
    currentFileUrl: text(row.CurrentFileUrl),
    currentFileName: text(row.CurrentFileName),
    currentFileType: text(row.CurrentFileType),
    assignmentCount: Number(row.AssignmentCount || 0),
    completedAssignmentCount: Number(row.CompletedAssignmentCount || 0),
    activeAssigneeNames: text(row.ActiveAssigneeNames),
    nearestDueDate: dateValue(row.NearestDueDate),
  };
}

function mapVersion(row: Record<string, unknown>): DocumentVersion {
  return {
    id: Number(row.Id),
    documentId: Number(row.DocumentId),
    versionNo: String(row.VersionNo),
    fileName: String(row.FileName),
    fileUrl: String(row.FileUrl),
    fileSize: num(row.FileSize),
    fileType: text(row.FileType),
    changeNote: text(row.ChangeNote),
    isCurrent: Boolean(row.IsCurrent),
    uploadedByUserId: Number(row.UploadedByUserId),
    uploadedByName: text(row.UploadedByName),
    uploadedAt: dateValue(row.UploadedAt) || "",
  };
}

function mapAssignment(row: Record<string, unknown>): DocumentAssignment {
  return {
    id: Number(row.Id),
    documentId: Number(row.DocumentId),
    assignedToUserId: num(row.AssignedToUserId),
    assignedToName: text(row.AssignedToName),
    assignedByUserId: Number(row.AssignedByUserId),
    assignedByName: text(row.AssignedByName),
    requiredRoleCode: text(row.RequiredRoleCode) as DocumentAssignment["requiredRoleCode"],
    dueDate: dateValue(row.DueDate),
    status: String(row.Status) as DocumentAssignment["status"],
    completedByUserId: num(row.CompletedByUserId),
    completedByName: text(row.CompletedByName),
    completedAt: dateValue(row.CompletedAt),
    completionNote: text(row.CompletionNote),
    assignedAt: dateValue(row.AssignedAt) || "",
  };
}

function mapAssignmentFile(row: Record<string, unknown>): DocumentAssignmentFile {
  return {
    id: Number(row.Id),
    documentId: Number(row.DocumentId),
    assignmentId: Number(row.AssignmentId),
    fileName: String(row.FileName),
    fileUrl: String(row.FileUrl),
    filePath: String(row.FilePath),
    fileSize: num(row.FileSize),
    fileType: text(row.FileType),
    note: text(row.Note),
    uploadedByUserId: Number(row.UploadedByUserId),
    uploadedByName: text(row.UploadedByName),
    uploadedAt: dateValue(row.UploadedAt) || "",
  };
}
function mapLog(row: Record<string, unknown>): DocumentLog {
  return {
    id: Number(row.Id),
    documentId: Number(row.DocumentId),
    action: String(row.Action),
    oldValue: text(row.OldValue),
    newValue: text(row.NewValue),
    createdByUserId: Number(row.CreatedByUserId),
    createdByName: text(row.CreatedByName),
    createdAt: dateValue(row.CreatedAt) || "",
  };
}

export async function listDocuments(typeCode?: string, search?: string, status?: string): Promise<DocumentListItem[]> {
  const pool = await getPool();
  const rs = await pool.request()
    .input("TypeCode", sql.NVarChar(50), typeCode ? typeCode.toUpperCase() : null)
    .input("Search", sql.NVarChar(200), search || null)
    .input("Status", sql.NVarChar(30), status || null)
    .execute("doc.sp_Document_List");
  return ((rs.recordset || []) as Record<string, unknown>[]).map(mapList);
}

export async function getDocument(id: number): Promise<DocumentDetail | null> {
  const pool = await getPool();
  const header = await pool.request().input("Id", sql.Int, id).execute("doc.sp_Document_GetHeader");
  if (!header.recordset?.[0]) return null;
  const versions = await pool.request().input("Id", sql.Int, id).execute("doc.sp_Document_GetVersions");
  const assignments = await pool.request().input("Id", sql.Int, id).execute("doc.sp_Document_GetAssignments");
  const assignmentFiles = await pool.request().input("Id", sql.Int, id).execute("doc.sp_Document_GetAssignmentFiles");
  const logs = await pool.request().input("Id", sql.Int, id).execute("doc.sp_Document_GetLogs");
  const filesByAssignment = new Map<number, DocumentAssignmentFile[]>();

  for (const file of ((assignmentFiles.recordset || []) as Record<string, unknown>[]).map(mapAssignmentFile)) {
    const files = filesByAssignment.get(file.assignmentId) || [];
    files.push(file);
    filesByAssignment.set(file.assignmentId, files);
  }

  return {
    ...mapList(header.recordset[0] as Record<string, unknown>),
    versions: ((versions.recordset || []) as Record<string, unknown>[]).map(mapVersion),
    assignments: ((assignments.recordset || []) as Record<string, unknown>[]).map((row) => {
      const assignment = mapAssignment(row);
      return {
        ...assignment,
        files: filesByAssignment.get(assignment.id) || [],
      };
    }),
    logs: ((logs.recordset || []) as Record<string, unknown>[]).map(mapLog),
  };
}

export async function createDocument(input: CreateDocumentInput, file: SavedFile, user: SessionUser) {
  const pool = await getPool();
  const rs = await pool.request()
    .input("DocumentTypeId", sql.Int, input.documentTypeId)
    .input("Title", sql.NVarChar(300), input.title)
    .input("DocumentNo", sql.NVarChar(100), input.documentNo || null)
    .input("Description", sql.NVarChar(sql.MAX), input.description || null)
    .input("VersionNo", sql.NVarChar(50), input.versionNo || null)
    .input("ChangeNote", sql.NVarChar(1000), input.changeNote || null)
    .input("AssignedToUserId", sql.Int, input.assignedToUserId || null)
    .input("DueDate", sql.DateTime2, input.dueDate ? new Date(input.dueDate) : null)
    .input("FileName", sql.NVarChar(260), file.fileName)
    .input("FileUrl", sql.NVarChar(1000), file.fileUrl)
    .input("FilePath", sql.NVarChar(1000), file.filePath)
    .input("FileSize", sql.Int, file.fileSize)
    .input("FileType", sql.NVarChar(120), file.fileType)
    .input("CreatedByUserId", sql.Int, user.userId)
    .execute("doc.sp_Document_Create");
  return Number(rs.recordset?.[0]?.Id);
}

export async function uploadNewVersion(documentId: number, versionNo: string, file: SavedFile, changeNote: string | null, user: SessionUser) {
  const pool = await getPool();
  await pool.request()
    .input("DocumentId", sql.Int, documentId)
    .input("VersionNo", sql.NVarChar(50), versionNo)
    .input("ChangeNote", sql.NVarChar(1000), changeNote)
    .input("FileName", sql.NVarChar(260), file.fileName)
    .input("FileUrl", sql.NVarChar(1000), file.fileUrl)
    .input("FilePath", sql.NVarChar(1000), file.filePath)
    .input("FileSize", sql.Int, file.fileSize)
    .input("FileType", sql.NVarChar(120), file.fileType)
    .input("UploadedByUserId", sql.Int, user.userId)
    .execute("doc.sp_Document_UploadVersion");
}

export async function updateDocument(id: number, input: UpdateDocumentInput, user: SessionUser) {
  const pool = await getPool();
  await pool.request()
    .input("Id", sql.Int, id)
    .input("Title", sql.NVarChar(300), input.title)
    .input("DocumentNo", sql.NVarChar(100), input.documentNo || null)
    .input("Description", sql.NVarChar(sql.MAX), input.description || null)
    .input("Status", sql.NVarChar(30), input.status || "ACTIVE")
    .input("UpdatedByUserId", sql.Int, user.userId)
    .execute("doc.sp_Document_Update");
}

export async function dashboardStats(user: SessionUser): Promise<{ totalDocuments: number; versionedDocuments: number; openAssignments: number; myAssignments: number; overdueAssignments: number }> {
  const pool = await getPool();
  const rs = await pool.request()
    .input("UserId", sql.Int, user.userId)
    .execute("doc.sp_Dashboard_Stats");
  const row = (rs.recordset?.[0] || {}) as Record<string, unknown>;
  return {
    totalDocuments: Number(row.totalDocuments || 0),
    versionedDocuments: Number(row.versionedDocuments || 0),
    openAssignments: Number(row.openAssignments || 0),
    myAssignments: Number(row.myAssignments || 0),
    overdueAssignments: Number(row.overdueAssignments || 0),
  };
}
export async function deleteDocument(id: number, user: SessionUser) {
  const pool = await getPool();
  const files = await pool.request()
    .input("DocumentId", sql.Int, id)
    .input("UserId", sql.Int, user.userId)
    .input("IsPrivileged", sql.Bit, isPrivileged(user) ? 1 : 0)
    .execute("doc.sp_Document_Delete_GetFiles");

  await deleteDriveFiles((files.recordset || []) as DeleteFileRow[]);

  await pool.request()
    .input("DocumentId", sql.Int, id)
    .input("DeletedByUserId", sql.Int, user.userId)
    .input("IsPrivileged", sql.Bit, isPrivileged(user) ? 1 : 0)
    .execute("doc.sp_Document_Delete");
}

export async function deleteDocumentVersion(documentId: number, versionId: number, user: SessionUser) {
  const pool = await getPool();
  const files = await pool.request()
    .input("DocumentId", sql.Int, documentId)
    .input("VersionId", sql.Int, versionId)
    .input("UserId", sql.Int, user.userId)
    .input("IsPrivileged", sql.Bit, isPrivileged(user) ? 1 : 0)
    .execute("doc.sp_DocumentVersion_Delete_GetFile");

  await deleteDriveFiles((files.recordset || []) as DeleteFileRow[]);

  await pool.request()
    .input("DocumentId", sql.Int, documentId)
    .input("VersionId", sql.Int, versionId)
    .input("DeletedByUserId", sql.Int, user.userId)
    .input("IsPrivileged", sql.Bit, isPrivileged(user) ? 1 : 0)
    .execute("doc.sp_DocumentVersion_Delete");
}

export async function uploadAssignmentFile(assignmentId: number, file: SavedFile, note: string | null, user: SessionUser) {
  const pool = await getPool();
  try {
    await pool.request()
      .input("AssignmentId", sql.Int, assignmentId)
      .input("FileName", sql.NVarChar(260), file.fileName)
      .input("FileUrl", sql.NVarChar(1000), file.fileUrl)
      .input("FilePath", sql.NVarChar(1000), file.filePath)
      .input("FileSize", sql.Int, file.fileSize)
      .input("FileType", sql.NVarChar(120), file.fileType)
      .input("Note", sql.NVarChar(1000), note || null)
      .input("UploadedByUserId", sql.Int, user.userId)
      .input("IsAdmin", sql.Bit, user.role === "ADMIN" ? 1 : 0)
      .execute("doc.sp_AssignmentFile_Upload");
  } catch (error) {
    await deleteDriveFileByPath(file.filePath).catch(() => undefined);
    throw error;
  }
}

export async function deleteAssignmentFile(assignmentId: number, fileId: number, user: SessionUser) {
  const pool = await getPool();
  const files = await pool.request()
    .input("AssignmentId", sql.Int, assignmentId)
    .input("FileId", sql.Int, fileId)
    .input("UserId", sql.Int, user.userId)
    .input("IsSupport", sql.Bit, user.role === "ADMIN" || user.role === "TBP" ? 1 : 0)
    .execute("doc.sp_AssignmentFile_Delete_GetFile");

  await deleteDriveFiles((files.recordset || []) as DeleteFileRow[]);

  await pool.request()
    .input("AssignmentId", sql.Int, assignmentId)
    .input("FileId", sql.Int, fileId)
    .input("DeletedByUserId", sql.Int, user.userId)
    .input("IsSupport", sql.Bit, user.role === "ADMIN" || user.role === "TBP" ? 1 : 0)
    .execute("doc.sp_AssignmentFile_Delete");
}
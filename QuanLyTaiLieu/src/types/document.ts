export type ModuleKind = "VERSIONED_DOCUMENT" | "ASSIGNMENT_DOCUMENT";
export type DocumentStatus = "DRAFT" | "ACTIVE" | "ARCHIVED" | "CANCELLED";
export type AssignmentStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE" | "CANCELLED";
export type AppRole = "ADMIN" | "TBP" | "USER";
export type DocPermission = "DOC_USER" | "DOC_TBP" | "DOC_ADMIN";

export type SessionUser = {
  userId: number;
  username: string;
  fullName: string;
  role: AppRole;
  permissions: DocPermission[];
};

export type DocumentType = {
  id: number;
  code: string;
  name: string;
  moduleKind: ModuleKind;
  description: string | null;
  isActive: boolean;
};

export type DocumentListItem = {
  id: number;
  documentTypeId: number;
  typeCode: string;
  typeName: string;
  moduleKind: ModuleKind;
  title: string;
  documentNo: string | null;
  description: string | null;
  status: DocumentStatus;
  createdByUserId: number;
  createdByName: string | null;
  createdAt: string;
  currentVersionNo: string | null;
  currentFileUrl: string | null;
  assignmentCount: number;
  completedAssignmentCount: number;
  nearestDueDate: string | null;
};

export type DocumentDetail = DocumentListItem & {
  versions: DocumentVersion[];
  assignments: DocumentAssignment[];
  logs: DocumentLog[];
};

export type DocumentVersion = {
  id: number;
  documentId: number;
  versionNo: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  fileType: string | null;
  changeNote: string | null;
  isCurrent: boolean;
  uploadedByUserId: number;
  uploadedByName: string | null;
  uploadedAt: string;
};

export type DocumentAssignment = {
  id: number;
  documentId: number;
  documentTitle?: string;
  assignedToUserId: number | null;
  assignedToName: string | null;
  assignedByUserId: number;
  assignedByName: string | null;
  requiredRoleCode: DocPermission | null;
  dueDate: string | null;
  status: AssignmentStatus;
  completedByUserId: number | null;
  completedByName: string | null;
  completedAt: string | null;
  completionNote: string | null;
  assignedAt: string;
};

export type DocumentLog = {
  id: number;
  documentId: number;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  createdByUserId: number;
  createdByName: string | null;
  createdAt: string;
};

export type TagUser = {
  id: number;
  username: string;
  fullName: string;
  department: string | null;
};

import { z } from "zod";

export const createDocumentSchema = z.object({
  documentTypeId: z.number().int().positive(),
  title: z.string().min(1, "Tên tài liệu là bắt buộc.").max(300),
  documentNo: z.string().max(100).optional().nullable(),
  description: z.string().optional().nullable(),
  versionNo: z.string().max(50).optional().nullable(),
  changeNote: z.string().max(1000).optional().nullable(),
  assignedToUserId: z.number().int().positive().optional().nullable(),
  dueDate: z.string().optional().nullable(),
});

export const updateDocumentSchema = z.object({
  title: z.string().min(1).max(300),
  documentNo: z.string().max(100).optional().nullable(),
  description: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED", "CANCELLED"]).optional(),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

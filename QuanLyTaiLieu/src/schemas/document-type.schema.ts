import { z } from "zod";

export const documentTypeSchema = z.object({
  code: z.string().min(2).max(50).regex(/^[A-Z0-9_]+$/, "Mã chỉ dùng chữ hoa, số và dấu gạch dưới."),
  name: z.string().min(1, "Tên là bắt buộc.").max(250),
  moduleKind: z.enum(["VERSIONED_DOCUMENT", "ASSIGNMENT_DOCUMENT"]),
  description: z.string().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
});

export type DocumentTypeInput = z.infer<typeof documentTypeSchema>;

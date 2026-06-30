import { z } from "zod";

export const completeAssignmentSchema = z.object({
  completionNote: z.string().max(1000).optional().nullable(),
});

export const createAssignmentSchema = z.object({
  documentId: z.number().int().positive(),
  assignedToUserId: z.number().int().positive().optional().nullable(),
  dueDate: z.string().optional().nullable(),
});

export type CompleteAssignmentInput = z.infer<typeof completeAssignmentSchema>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

import { z } from "zod";

const titleSchema = z.string()
    .min(1)
    .refine((value) => !/<[^>]*>/.test(value), {
        message: "title must not contain HTML tags"
    })
    .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), {
        message: "title must not contain control characters"
    });

const createWorkItemSchema = z.object({
    title: titleSchema
}).strict();

const updateWorkItemSchema = z.object({
    title: titleSchema.optional(),
    assignee_id: z.number().int().positive().optional()
}).strict().refine(
    (data) => data.title !== undefined || data.assignee_id !== undefined,
    { message: "Provide title or assignee_id to update" }
);

export {
    createWorkItemSchema,
    updateWorkItemSchema
};
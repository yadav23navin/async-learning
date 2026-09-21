import { z } from "zod";

const createWorkItemSchema = z.object({
    title: z.string()
        .min(1)
        .refine((value) => !/<[^>]*>/.test(value), {
            message: "title must not contain HTML tags"
        })
        .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), {
            message: "title must not contain control characters"
        })
}).strict();

const updateWorkItemSchema = z.object({
    title: z.string()
        .min(1)
        .refine((value) => !/<[^>]*>/.test(value), {
            message: "title must not contain HTML tags"
        })
        .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), {
            message: "title must not contain control characters"
        })
}).strict();

export {
    createWorkItemSchema,
    updateWorkItemSchema
};
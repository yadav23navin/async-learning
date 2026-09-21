import { z } from "zod";

const createProjectSchema = z.object({
    name: z.string()
        .min(1)
        .refine((value) => !/<[^>]*>/.test(value), {
            message: "name must not contain HTML tags"
        })
        .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), {
            message: "name must not contain control characters"
        })
}).strict();

const updateProjectSchema = z.object({
    name: z.string()
        .min(1)
        .refine((value) => !/<[^>]*>/.test(value), {
            message: "name must not contain HTML tags"
        })
        .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), {
            message: "name must not contain control characters"
        })
}).strict();

export {
    createProjectSchema,
    updateProjectSchema
};
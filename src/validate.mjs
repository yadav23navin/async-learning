import AppError from "./AppError.mjs";

const validate = (schema) => {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);

        if (!result.success) {

            // Construct a detailed error message from the validation issues
            const message = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ");
            throw new AppError(
                //"Request validation failed",
                message,
                400,
                "VALIDATION_ERROR"
            );
        }

        req.body = result.data;

        next();
    };
};

export default validate;
import AppError from "./AppError.mjs";

const rejectDuplicateKeys = (req, res, next) => {
    if (!req.rawBody) {
        return next();
    }
    const keys = [...req.rawBody.matchAll(/"([^"]+)"\s*:/g)]
        .map((match) => match[1]);

    const duplicates = keys.filter(
        (key, index) => keys.indexOf(key) !== index
    );

    if (duplicates.length > 0) {
        throw new AppError(
            `Duplicate key: "${duplicates[0]}"`,
            400,
            "VALIDATION_ERROR"
        );
    }

    next();
};

export default rejectDuplicateKeys;
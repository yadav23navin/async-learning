import displayMessages from "./displayMessages.mjs";

const errorHandler = (error, req, res, next) => {

    // Handle specific error types, such as payload too large
    if (error.type === "entity.too.large") {
    return res.status(400).json({
        success: false,
        errorCode: "VALIDATION_ERROR",
        message: "Request body is too large"
    });
}
    console.error(error);

    const message =
    error.errorCode === "VALIDATION_ERROR" 
    ? error.message :
        displayMessages[error.errorCode] ||
        displayMessages.INTERNAL_ERROR;

    const response = {
        success: false,
        errorCode: error.errorCode || "INTERNAL_ERROR",
        message
    };

    if (process.env.NODE_ENV !== "production") {
        response.stack = error.stack;
    }

    res.status(error.statusCode || 500).json(response);
};

export default errorHandler;
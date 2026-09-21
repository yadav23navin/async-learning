class AppError extends Error{
    constructor(message, statusCode , errorcode){
        super(message);

        this.statusCode = statusCode;
        this.errorCode = errorcode;
    }

}
export default AppError;

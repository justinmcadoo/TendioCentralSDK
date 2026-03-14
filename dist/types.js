export class TendioAuthError extends Error {
    code;
    statusCode;
    retryAfter;
    constructor(code, message, options) {
        super(message, { cause: options?.cause });
        this.name = 'TendioAuthError';
        this.code = code;
        this.statusCode = options?.statusCode;
        this.retryAfter = options?.retryAfter;
    }
}
//# sourceMappingURL=types.js.map
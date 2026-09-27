/** Errors that map to a stable JSON error body: { error, message, requestId, details? }. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    /** Optional structured detail, e.g. the list of problems blocking a submit. */
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = (message = 'Sign in required') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);
export const badRequest = (message: string) => new AppError(400, 'BAD_REQUEST', message);

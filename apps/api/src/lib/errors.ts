export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) { super(message); }
}

export const notFound = (resource: string): never => { throw new AppError(404, 'NOT_FOUND', `${resource} not found`); };
export const forbidden = (message = 'You do not have permission to perform this action'): never => { throw new AppError(403, 'FORBIDDEN', message); };

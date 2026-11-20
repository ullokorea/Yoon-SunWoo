export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'BOOKING_BLOCKED'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  BOOKING_BLOCKED: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError('BAD_REQUEST', m, d);
export const validation = (m: string, d?: unknown) => new AppError('VALIDATION', m, d);
export const unauthorized = (m = '로그인이 필요해요.') => new AppError('UNAUTHORIZED', m);
export const forbidden = (m = '접근 권한이 없어요.') => new AppError('FORBIDDEN', m);
export const notFound = (m = '찾을 수 없어요.') => new AppError('NOT_FOUND', m);
export const conflict = (m: string, d?: unknown) => new AppError('CONFLICT', m, d);

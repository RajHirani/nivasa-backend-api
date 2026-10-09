export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'REFRESH_TOKEN_REUSED'
  | 'FORBIDDEN'
  | 'NOT_A_MEMBER'
  | 'MEMBERSHIP_INACTIVE'
  | 'NOT_FOUND'
  | 'ACCOUNT_NOT_FOUND'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_ATTEMPTS_EXCEEDED'
  | 'MOBILE_ALREADY_EXISTS'
  | 'EMAIL_ALREADY_EXISTS'
  | 'RATE_LIMITED'
  | 'HOME_NOT_APPROVED'
  | 'HOME_ALREADY_REQUESTED'
  | 'HOME_NOT_EDITABLE'
  | 'HOME_NOT_CANCELLABLE'
  | 'REQUEST_NOT_PENDING'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'UPLOAD_IN_USE'
  | 'INTERNAL_ERROR';

export interface ErrorDetail {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

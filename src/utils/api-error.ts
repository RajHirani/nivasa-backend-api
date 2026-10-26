export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'REFRESH_TOKEN_REUSED'
  | 'FORBIDDEN'
  | 'NOT_A_MEMBER'
  | 'MEMBERSHIP_INACTIVE'
  | 'SOCIETY_INACTIVE'
  | 'NOT_FOUND'
  | 'ACCOUNT_NOT_FOUND'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_ATTEMPTS_EXCEEDED'
  | 'OTP_LOCKED'
  | 'MOBILE_ALREADY_EXISTS'
  | 'EMAIL_ALREADY_EXISTS'
  | 'STAFF_ALREADY_EXISTS'
  | 'ADMIN_ALREADY_EXISTS'
  | 'REGISTRATION_NUMBER_TAKEN'
  | 'SOCIETY_NAME_TAKEN'
  | 'CANNOT_CHANGE_SELF'
  | 'LAST_SUPER_ADMIN'
  | 'RATE_LIMITED'
  | 'HOME_NOT_APPROVED'
  | 'HOME_ALREADY_REQUESTED'
  | 'HOME_NOT_CANCELLABLE'
  | 'REQUEST_NOT_PENDING'
  | 'NOT_DAILY_HELP'
  | 'DUPLICATE_PROVIDER'
  | 'DUPLICATE_CONTACT'
  | 'DUPLICATE_UNIT_NUMBER'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'UPLOAD_IN_USE'
  | 'LAST_PRESIDENT'
  | 'ALREADY_ON_COMMITTEE'
  | 'PHONE_BELONGS_TO_RESIDENT'
  | 'TERM_NAME_TAKEN'
  | 'TERM_NOT_CURRENT'
  | 'TICKET_INVALID_TRANSITION'
  | 'ROLE_NAME_TAKEN'
  | 'ROLE_LOCKED'
  | 'NOTICE_READ_ONLY'
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

import type { ErrorCode } from "@codetgh/shared";

export class HubError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryAfterS?: number,
  ) {
    super(message);
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  E_UNAUTHORIZED: 401,
  E_FORBIDDEN: 403,
  E_INVALID: 400,
  E_NOT_FOUND: 404,
  E_TOO_LARGE: 413,
  E_SECRET_BLOCKED: 422,
  E_RATE_LIMITED: 429,
  E_LOOP_GUARD: 409,
  E_KILL_SWITCH: 503,
  E_CLAIM_CONFLICT: 409,
  E_VERSION_CONFLICT: 409,
  E_NO_DELEGATE: 403,
  E_DELEGATE_BUSY: 409,
  E_DELEGATE_CHAIN: 403,
};

import { errorJson } from "@/lib/server/api/errorResponse";

export class ApplicationRecordNotFoundError extends Error {
  constructor(readonly entity: string) {
    super(`${entity} not found`);
    this.name = "ApplicationRecordNotFoundError";
  }
}

export class ApplicationEventConflictError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ApplicationEventConflictError";
  }
}

export function applicationEventErrorResponse(
  error: unknown,
  requestId?: string,
) {
  if (error instanceof ApplicationRecordNotFoundError) {
    const entityCode = error.entity.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    return errorJson(
      `${entityCode}_NOT_FOUND`,
      error.message,
      404,
      { requestId },
    );
  }
  if (error instanceof ApplicationEventConflictError) {
    return errorJson(error.code, error.message, 409, { requestId });
  }
  return null;
}

import { errorJson } from "@/lib/server/api/errorResponse";

export class CareerNotFoundError extends Error {
  constructor(readonly entity: string) {
    super(`${entity} not found`);
    this.name = "CareerNotFoundError";
  }
}

export class CareerConflictError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CareerConflictError";
  }
}

export function careerErrorResponse(error: unknown, requestId?: string) {
  if (error instanceof CareerNotFoundError) {
    const entityCode = error.entity.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    return errorJson(
      `${entityCode}_NOT_FOUND`,
      error.message,
      404,
      { requestId },
    );
  }
  if (error instanceof CareerConflictError) {
    return errorJson(error.code, error.message, 409, { requestId });
  }
  return null;
}

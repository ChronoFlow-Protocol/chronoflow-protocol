/** Error shape returned by every failing endpoint. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Renders any thrown value as a readable message.
 *
 * The Soroban RPC client rejects with plain `{ code, message, data }` objects
 * rather than `Error` instances, which would otherwise be logged as
 * "[object Object]" and hide the actual cause.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (error !== null && typeof error === "object") {
    const shaped = error as { message?: unknown; code?: unknown; data?: unknown };

    if (typeof shaped.message === "string" && shaped.message.length > 0) {
      const code = typeof shaped.code === "number" ? ` (code ${shaped.code})` : "";
      const data = shaped.data === undefined ? "" : ` ${JSON.stringify(shaped.data)}`;
      return `${shaped.message}${code}${data}`;
    }

    try {
      const rendered = JSON.stringify(error);
      if (rendered && rendered !== "{}") return rendered;
    } catch {
      // Fall through to String().
    }
  }

  return String(error);
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const badRequest = (message: string, details?: unknown): HttpError =>
  new HttpError(400, "BAD_REQUEST", message, details);

export const notFound = (message: string): HttpError => new HttpError(404, "NOT_FOUND", message);

export const serviceUnavailable = (message: string, details?: unknown): HttpError =>
  new HttpError(503, "SERVICE_UNAVAILABLE", message, details);

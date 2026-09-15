import type { ErrorRequestHandler, RequestHandler } from "express";

import { HttpError, type ApiErrorBody } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiErrorBody = {
    error: {
      code: "NOT_FOUND",
      message: `no route matches ${req.method} ${req.originalUrl}`,
    },
  };
  res.status(404).json(body);
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, _next) => {
    if (error instanceof HttpError) {
      if (error.status >= 500) {
        logger.warn("request failed", {
          path: req.path,
          status: error.status,
          error: error.message,
        });
      }
      res.status(error.status).json(error.toBody());
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error("unhandled error", { path: req.path, method: req.method, error: message });

    const body: ApiErrorBody = {
      error: {
        code: "INTERNAL_ERROR",
        message: "internal server error",
      },
    };
    res.status(500).json(body);
  };
}

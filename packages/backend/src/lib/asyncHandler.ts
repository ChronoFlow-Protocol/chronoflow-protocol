import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps an async handler so rejected promises reach the Express error
 * middleware instead of becoming unhandled rejections.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

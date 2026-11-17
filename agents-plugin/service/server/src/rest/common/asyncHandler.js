/**
 * Wraps an async Express handler so rejected promises are forwarded to `next`,
 * removing the per-method try/catch boilerplate.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

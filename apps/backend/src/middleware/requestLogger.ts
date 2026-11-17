import { Request, Response, NextFunction } from 'express';

/**
 * Minimal, PII-free access log.
 *
 * We log only the HTTP method, the route pattern (never the raw URL/query),
 * status code and duration. Request bodies, headers, IP addresses, user
 * identifiers and session tokens are deliberately never written to logs.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    // req.route?.path is a pattern like '/:id'; fall back to the mounted path.
    const route = (req as any).route?.path
      ? `${req.baseUrl}${(req as any).route.path}`
      : req.baseUrl || req.path.split('/').slice(0, 2).join('/') || '/';
    const safeRoute = String(route).replace(/:[A-Za-z0-9_]+/g, ':id');
    console.log(
      `[HTTP] ${req.method} ${safeRoute} ${res.statusCode} ${durationMs.toFixed(1)}ms`
    );
  });

  next();
}

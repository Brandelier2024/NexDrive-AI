/**
 * In-memory sliding-window rate limiter for sensitive authentication endpoints.
 * Automatically evicts expired entries to prevent memory leaks.
 */

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitRecord>();

// Clean up expired keys every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupExpired() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}

export interface RateLimitOptions {
  windowMs: number; // Duration of window in milliseconds
  max: number;      // Maximum allowed requests within window
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Checks and increments the hit counter for a given key.
 */
export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  cleanupExpired();

  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetAt) {
    rateLimitMap.set(key, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return {
      allowed: true,
      remaining: options.max - 1,
      retryAfterSeconds: Math.ceil(options.windowMs / 1000),
    };
  }

  if (record.count >= options.max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  record.count += 1;
  return {
    allowed: true,
    remaining: options.max - record.count,
    retryAfterSeconds: Math.ceil((record.resetAt - now) / 1000),
  };
}

/**
 * Extracts the client's IP address from incoming Next.js Request headers.
 */
export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "127.0.0.1";
}

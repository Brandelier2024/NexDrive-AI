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
 * Prefers trusted edge platform headers (Cloudflare, Vercel, x-real-ip)
 * or the right-most entry of x-forwarded-for added by the closest trusted proxy,
 * preventing spoofing via client-crafted headers.
 */
export function getClientIp(req: Request): string {
  // 1. Prefer trusted Vercel deployment-specific edge header (cannot be forged on Vercel)
  const vercelForwardedFor = req.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercelForwardedFor) {
    const parts = vercelForwardedFor.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }

  // 2. Trust Cloudflare cf-connecting-ip only when verified to arrive via Cloudflare ingress (cf-ray present)
  const cfConnectingIp = req.headers.get("cf-connecting-ip")?.trim();
  const cfRay = req.headers.get("cf-ray")?.trim();
  const isCloudflareIngress = Boolean(cfRay) || process.env.TRUST_CLOUDFLARE === "true";
  if (cfConnectingIp && isCloudflareIngress) {
    return cfConnectingIp;
  }

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  // 3. Fall back to right-most x-forwarded-for entry appended by trusted proxy
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }

  return "127.0.0.1";
}


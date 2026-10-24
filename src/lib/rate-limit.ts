/**
 * In-memory sliding-window rate limiter for sensitive authentication endpoints.
 * Automatically evicts expired entries to prevent memory leaks.
 */

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

// Preserve rate limit map across module reloads / hot-reloads within the same Node.js worker/process
const globalForRateLimit = globalThis as unknown as {
  __rateLimitMap?: Map<string, RateLimitRecord>;
  __lastRateLimitCleanup?: number;
};

const rateLimitMap =
  globalForRateLimit.__rateLimitMap ?? new Map<string, RateLimitRecord>();
if (!globalForRateLimit.__rateLimitMap) {
  globalForRateLimit.__rateLimitMap = rateLimitMap;
}

// Clean up expired keys every 5 minutes and enforce maximum memory capacity
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const MAX_MAP_ENTRIES = 10000;
let lastCleanup = globalForRateLimit.__lastRateLimitCleanup ?? Date.now();

function cleanupExpired() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL && rateLimitMap.size < MAX_MAP_ENTRIES) return;
  lastCleanup = now;
  globalForRateLimit.__lastRateLimitCleanup = now;

  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetAt) {
      rateLimitMap.delete(key);
    }
  }

  // If still above capacity (e.g. deliberate key flooding), evict oldest entries
  if (rateLimitMap.size >= MAX_MAP_ENTRIES) {
    const keysToEvict = Array.from(rateLimitMap.keys()).slice(0, Math.floor(MAX_MAP_ENTRIES / 4));
    for (const key of keysToEvict) {
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
      remaining: Math.max(0, options.max - 1),
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
    remaining: Math.max(0, options.max - record.count),
    retryAfterSeconds: Math.max(1, Math.ceil((record.resetAt - now) / 1000)),
  };
}

/**
 * Resets the in-memory rate limiter state. Intended for testing.
 */
export function resetRateLimits(): void {
  rateLimitMap.clear();
}

const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const IPV6_REGEX = /^[0-9a-fA-F:.]+$/;

function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;
  const trimmed = ip.trim();
  if (trimmed.length === 0 || trimmed.length > 45) return false;
  return IPV4_REGEX.test(trimmed) || IPV6_REGEX.test(trimmed);
}

/**
 * Extracts the client's IP address from incoming Next.js Request headers.
 * Prefers trusted edge platform headers (Cloudflare, Vercel, x-real-ip)
 * or the right-most entry of x-forwarded-for added by the closest trusted proxy,
 * validating format against IPv4/IPv6 standards to prevent header injection.
 */
export function getClientIp(req: Request): string {
  // 1. Prefer trusted Vercel deployment-specific edge header (cannot be forged on Vercel)
  const vercelForwardedFor = req.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercelForwardedFor) {
    const parts = vercelForwardedFor.split(",").map((p) => p.trim()).filter(Boolean);
    const candidate = parts[parts.length - 1];
    if (candidate && isValidIp(candidate)) {
      return candidate;
    }
  }

  // 2. Trust Cloudflare cf-connecting-ip only when verified to arrive via Cloudflare ingress (cf-ray present)
  const cfConnectingIp = req.headers.get("cf-connecting-ip")?.trim();
  const cfRay = req.headers.get("cf-ray")?.trim();
  const isCloudflareIngress = Boolean(cfRay) || process.env.TRUST_CLOUDFLARE === "true";
  if (cfConnectingIp && isCloudflareIngress && isValidIp(cfConnectingIp)) {
    return cfConnectingIp;
  }

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp && isValidIp(realIp)) {
    return realIp;
  }

  // 3. Fall back to right-most x-forwarded-for entry appended by trusted proxy
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor.split(",").map((p) => p.trim()).filter(Boolean);
    const candidate = parts[parts.length - 1];
    if (candidate && isValidIp(candidate)) {
      return candidate;
    }
  }

  return "127.0.0.1";
}


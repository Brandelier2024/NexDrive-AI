/** Application configuration — reads from environment variables */

export const config = {
  // Azure AD / Microsoft Graph
  azure: {
    tenantId: process.env.AZURE_TENANT_ID ?? "",
    clientId: process.env.AZURE_CLIENT_ID ?? "",
    clientSecret: process.env.AZURE_CLIENT_SECRET ?? "",
    driveId: process.env.ONEDRIVE_DRIVE_ID ?? "",
  },

  // Auth
  auth: {
    get secret(): string {
      const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
      if (!secret || secret === "dev-secret") {
        if (process.env.NODE_ENV === "production") {
          throw new Error(
            "[FATAL SECURITY ERROR] AUTH_SECRET or NEXTAUTH_SECRET environment variable is missing or set to insecure default in production."
          );
        }
        return "dev-secret";
      }
      return secret;
    },
    allowedEmailDomain: process.env.ALLOWED_EMAIL_DOMAIN ?? "yourcompany.com",
    get adminEmails(): string[] {
      return (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
    },
  },


  // Supabase
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  },

  // Gemini
  gemini: {
    get apiKey(): string {
      return (process.env.GOOGLE_API_KEY ?? "").split(",")[0]?.trim() ?? "";
    },
    visionModel: process.env.VISION_MODEL ?? "gemini-2.5-flash",
    embeddingModel: process.env.EMBEDDING_MODEL ?? "models/gemini-embedding-001",
    enableVisionCaptioning: process.env.ENABLE_VISION_CAPTIONING === "true",
  },

  // Search
  search: {
    topK: parseInt(process.env.TOP_K_MATCHES ?? "8", 10),
    similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD ?? "0.30"),
  },
} as const;

/** Validates that an email belongs to the allowed company domain */
export function isCompanyEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  const parts = normalized.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const domain = config.auth.allowedEmailDomain.toLowerCase();
  return parts[1] === domain;
}

/**
 * Checks whether a given user email has administrative privileges.
 * Relies strictly on configured ADMIN_EMAILS and returns false when unset or empty.
 */
export function isAdminUser(email?: string | null): boolean {
  if (!email || typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();

  // Validate complete email structure with exactly one @
  const parts = normalized.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return false;
  }

  // Rely strictly on configured ADMIN_EMAILS (fail-closed if unset or empty)
  const adminList = config.auth.adminEmails;
  if (adminList.length === 0) {
    return false;
  }

  return adminList.includes(normalized);
}

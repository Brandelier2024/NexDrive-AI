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
    secret: process.env.NEXTAUTH_SECRET ?? "dev-secret",
    allowedEmailDomain: process.env.ALLOWED_EMAIL_DOMAIN ?? "yourcompany.com",
    adminEmails: (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  },

  // Supabase
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  },

  // Gemini
  gemini: {
    apiKey: (process.env.GOOGLE_API_KEY ?? "").split(",")[0]?.trim() ?? "",
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
  const domain = config.auth.allowedEmailDomain.toLowerCase();
  return email.toLowerCase().endsWith(`@${domain}`);
}

/**
 * Checks whether a given user email has administrative privileges.
 * Checked against configured ADMIN_EMAILS environment variable or known admin patterns.
 */
export function isAdminUser(email?: string | null): boolean {
  if (!email || typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();

  // 1. Explicitly configured ADMIN_EMAILS in environment
  if (config.auth.adminEmails.length > 0) {
    return config.auth.adminEmails.includes(normalized);
  }

  // 2. Default administrative accounts and conventions
  const domain = config.auth.allowedEmailDomain.toLowerCase();
  const defaultAdmin = `admin@${domain}`;
  const dataAdmin = `data.brandelier@brandelier.in`;
  const dataAdmin2 = `data.brandelier2@brandelier.in`;

  return (
    normalized === defaultAdmin ||
    normalized === dataAdmin ||
    normalized === dataAdmin2 ||
    (normalized.startsWith("admin@") && isCompanyEmail(normalized))
  );
}

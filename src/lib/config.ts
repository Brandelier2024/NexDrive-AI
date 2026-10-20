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
  },

  // Supabase
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  },

  // Gemini
  gemini: {
    apiKey: process.env.GOOGLE_API_KEY ?? "",
    visionModel: process.env.VISION_MODEL ?? "gemini-3.8-flash",
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
  const domain = config.auth.allowedEmailDomain.toLowerCase();
  return email.toLowerCase().endsWith(`@${domain}`);
}

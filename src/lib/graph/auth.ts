import { config } from "@/lib/config";

interface TokenCache {
  accessToken: string;
  expiresAt: number; // Unix timestamp in ms
}

let cachedToken: TokenCache | null = null;
let activeTokenPromise: Promise<string> | null = null;

/**
 * Checks if live Azure credentials have been configured
 */
export function isAzureConfigured(): boolean {
  const { tenantId, clientId, clientSecret, driveId } = config.azure;
  return (
    Boolean(tenantId) &&
    Boolean(clientId) &&
    Boolean(clientSecret) &&
    !tenantId.includes("your_") &&
    !clientId.includes("your_") &&
    !clientSecret.includes("your_") &&
    Boolean(driveId) &&
    !driveId.includes("your_")
  );
}

/**
 * Obtains an application-only Bearer token for Microsoft Graph API
 * using OAuth2 Client Credentials Flow. Caches token until near expiry
 * and eliminates thundering herd / token stampedes via single-flight mutex.
 */
export async function getGraphAccessToken(): Promise<string> {
  const { tenantId, clientId, clientSecret } = config.azure;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Missing Azure AD credentials (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET) in .env.local"
    );
  }

  // Return cached token if valid for at least 5 more minutes
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 5 * 60 * 1000) {
    return cachedToken.accessToken;
  }

  // Deduplicate in-flight token requests to eliminate the thundering herd problem
  if (activeTokenPromise) {
    return activeTokenPromise;
  }

  activeTokenPromise = (async () => {
    try {
      const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      });

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Azure AD token request failed (${response.status} ${response.statusText}): ${errorBody}`
        );
      }

      const data = (await response.json()) as {
        token_type: string;
        expires_in: number;
        access_token: string;
      };

      cachedToken = {
        accessToken: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };

      return data.access_token;
    } finally {
      activeTokenPromise = null;
    }
  })();

  return activeTokenPromise;
}

import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import CredentialsProvider from "next-auth/providers/credentials";
import { config, isCompanyEmail } from "@/lib/config";
import { createServerSupabaseClient } from "@/lib/supabase";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: config.auth.secret,
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  providers: [
    // Microsoft Entra ID SSO for company Microsoft 365 accounts
    MicrosoftEntraID({
      clientId: config.azure.clientId,
      clientSecret: config.azure.clientSecret,
      issuer: `https://login.microsoftonline.com/${config.azure.tenantId}/v2.0`,
      authorization: {
        params: {
          scope: "openid profile email User.Read",
        },
      },
    }),

    // Credentials fallback — email + password with company domain check
    CredentialsProvider({
      name: "Company Email",
      credentials: {
        email: { label: "Company Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const rawEmail = credentials?.email as string;
        const password = credentials?.password as string;

        if (!rawEmail || !password) return null;
        const normalizedEmail = rawEmail.trim().toLowerCase();

        // Enforce company email domain
        if (!isCompanyEmail(normalizedEmail)) {
          throw new Error("INVALID_DOMAIN");
        }

        const supabase = createServerSupabaseClient();

        // Look up user in Supabase
        const { data: user, error } = await supabase
          .from("users")
          .select("id, name, email, password_hash, auth_provider, avatar_url")
          .eq("email", normalizedEmail)
          .single();

        if (error || !user) {
          throw new Error("USER_NOT_FOUND");
        }

        // Prevent null password hash crash for SSO-created accounts
        if (!user.password_hash) {
          throw new Error("USE_SSO_LOGIN");
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
          throw new Error("INVALID_CREDENTIALS");
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.avatar_url,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // For Azure AD SSO — enforce company email domain
      if (account?.provider === "microsoft-entra-id") {
        if (!user.email || !isCompanyEmail(user.email)) {
          return "/auth/error?error=INVALID_DOMAIN";
        }

        // Atomic SSO provisioning via upsert to eliminate TOCTOU race condition
        const supabase = createServerSupabaseClient();
        const normalizedEmail = user.email.toLowerCase().trim();

        const { data: provisionedUser, error: upsertError } = await supabase
          .from("users")
          .upsert(
            {
              email: normalizedEmail,
              name: user.name ?? normalizedEmail.split("@")[0],
              avatar_url: user.image ?? null,
              auth_provider: "azure-ad",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "email" }
          )
          .select("id")
          .single();

        if (upsertError || !provisionedUser) {
          console.error("[SSO Provisioning Error]:", upsertError);
          return "/auth/error?error=PROVISIONING_FAILED";
        }

        user.id = provisionedUser.id;
      }

      return true;
    },

    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
      }
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});

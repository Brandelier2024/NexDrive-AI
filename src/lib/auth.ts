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
          scope: "openid profile email User.Read Files.Read offline_access",
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
        const email = credentials?.email as string;
        const password = credentials?.password as string;

        if (!email || !password) return null;

        // Enforce company email domain
        if (!isCompanyEmail(email)) {
          throw new Error("INVALID_DOMAIN");
        }

        const supabase = createServerSupabaseClient();

        // Look up user in Supabase
        const { data: user, error } = await supabase
          .from("users")
          .select("*")
          .eq("email", email.toLowerCase())
          .single();

        if (error || !user) {
          throw new Error("USER_NOT_FOUND");
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

        // Auto-create user in Supabase if not exists (SSO provisioning)
        const supabase = createServerSupabaseClient();
        const { data: existingUser } = await supabase
          .from("users")
          .select("id")
          .eq("email", user.email.toLowerCase())
          .single();

        if (!existingUser) {
          const { data: newUser } = await supabase
            .from("users")
            .insert({
              email: user.email.toLowerCase(),
              name: user.name ?? user.email.split("@")[0],
              avatar_url: user.image ?? null,
              auth_provider: "azure-ad",
            })
            .select("id")
            .single();

          if (newUser) {
            user.id = newUser.id;
          }
        } else {
          user.id = existingUser.id;
        }
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
      if (token.accessToken) {
        Object.assign(session, { accessToken: token.accessToken });
      }
      return session;
    },
  },
});

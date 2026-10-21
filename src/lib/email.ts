import crypto from "crypto";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import { createServerSupabaseClient } from "@/lib/supabase";

// In-memory OTP store fallback
interface OtpEntry {
  code: string;
  expiresAt: number;
  attempts: number;
}
const otpStore = new Map<string, OtpEntry>();

/**
 * Constant-time string comparison with safe buffer length handling
 */
function safeTimingCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Safely resolves the server-side Supabase client if configured
 */
function getSupabaseClient(): ReturnType<typeof createServerSupabaseClient> | null {
  try {
    return createServerSupabaseClient();
  } catch {
    return null;
  }
}

/**
 * Deletes an OTP entry from both the in-memory map and Supabase table
 */
async function deleteOtp(email: string): Promise<void> {
  otpStore.delete(email);
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from("email_verifications").delete().eq("email", email);
    } catch {
      // In-memory fallback if Supabase is unavailable
    }
  }
}

/**
 * Generates a cryptographically secure 6-digit numeric verification code
 */
export function generateOtpCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Stores an OTP code for an email with a 10-minute expiry
 */
export async function storeOtp(email: string, code: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  // 1. Always record in the in-memory OTP store so the code is never lost
  // even if Supabase table is not yet migrated or PostgREST schema cache is stale
  otpStore.set(normalizedEmail, { code, expiresAt, attempts: 0 });

  // 2. Persist in Supabase email_verifications table if available
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase.from("email_verifications").upsert({
        email: normalizedEmail,
        code,
        expires_at: new Date(expiresAt).toISOString(),
        attempts: 0,
      }, { onConflict: "email" });

      if (error) {
        console.warn(
          `[OTP Store] Supabase email_verifications table unavailable (${error.message || "error"}). Falling back to in-memory OTP store.`
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[OTP Store] Supabase persistence exception (${message}). Falling back to in-memory OTP store.`);
    }
  }
}

/**
 * Verifies and consumes the OTP code
 */
export async function verifyOtp(email: string, inputCode: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();
  const trimmedCode = inputCode.trim();

  // 1. Try Supabase first if available
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("email_verifications")
        .select("*")
        .eq("email", normalizedEmail)
        .single();

      if (!error && data) {
        const isExpired = new Date(data.expires_at).getTime() < Date.now();
        if (isExpired) {
          await deleteOtp(normalizedEmail);
          return false;
        }

        const currentAttempts = typeof data.attempts === "number" ? data.attempts : 0;
        if (currentAttempts >= 5) {
          await deleteOtp(normalizedEmail);
          return false;
        }

        if (safeTimingCompare(data.code, trimmedCode)) {
          await deleteOtp(normalizedEmail);
          return true;
        }

        const nextAttempts = currentAttempts + 1;
        if (nextAttempts >= 5) {
          await deleteOtp(normalizedEmail);
        } else {
          await supabase
            .from("email_verifications")
            .update({ attempts: nextAttempts })
            .eq("email", normalizedEmail);
        }
        return false;
      }
    } catch {
      // Supabase query error, table missing, or connection issue -> proceed to in-memory fallback
    }
  }

  // 2. Fallback: Check in-memory store (active when Supabase table is not yet created or missing from cache)
  const memEntry = otpStore.get(normalizedEmail);
  if (memEntry) {
    if (Date.now() > memEntry.expiresAt) {
      await deleteOtp(normalizedEmail);
      return false;
    }

    if (memEntry.attempts >= 5) {
      await deleteOtp(normalizedEmail);
      return false;
    }

    if (safeTimingCompare(memEntry.code, trimmedCode)) {
      await deleteOtp(normalizedEmail);
      return true;
    }

    memEntry.attempts += 1;
    if (memEntry.attempts >= 5) {
      await deleteOtp(normalizedEmail);
    }
    return false;
  }

  return false;
}

/**
 * Sends branded verification email with 6-digit OTP code
 */
export async function sendVerificationEmail(
  toEmail: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  const sanitizedCode = code.trim();
  if (!/^\d{6}$/.test(sanitizedCode)) {
    return { success: false, error: "Invalid verification code format. Expected 6 digits." };
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const smtpHost = process.env.SMTP_HOST;
  const fromEmail = process.env.EMAIL_FROM || "Brandelier AI <onboarding@resend.dev>";

  const emailHtml = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Your Brandelier Verification Code</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 40px 20px;">
    <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 36px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; background: #4f46e5; color: #ffffff; font-size: 20px; font-weight: 700; padding: 10px 16px; border-radius: 8px;">
          Brandelier MediaWorks
        </div>
      </div>
      <h2 style="color: #0f172a; font-size: 22px; font-weight: 700; text-align: center; margin-bottom: 12px;">Verify your corporate email</h2>
      <p style="color: #475569; font-size: 15px; line-height: 1.6; text-align: center; margin-bottom: 28px;">
        Use the following 6-digit verification code to complete your registration for the <strong>OneDrive Media Locator</strong>.
      </p>
      <div style="background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 10px; padding: 20px; text-align: center; margin-bottom: 28px;">
        <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1e1b4b; font-family: monospace;">
          ${sanitizedCode}
        </span>
      </div>
      <p style="color: #64748b; font-size: 13px; text-align: center; line-height: 1.5; margin-bottom: 0;">
        This code is valid for <strong>10 minutes</strong>. If you did not request this account creation, please disregard this email.
      </p>
    </div>
  </body>
  </html>
  `;

  // 1. Try Resend if configured
  if (resendApiKey && resendApiKey !== "your_resend_api_key") {
    try {
      const resend = new Resend(resendApiKey);
      const res = await resend.emails.send({
        from: fromEmail,
        to: toEmail,
        subject: `Your Brandelier Verification Code: ${sanitizedCode}`,
        html: emailHtml,
      });

      if (res.error) {
        console.error("[Email] Resend delivery error:", res.error);
        return { success: false, error: res.error.message };
      }

      console.log(`[Email] Resend successfully delivered verification code to ${toEmail}`);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to send email via Resend.";
      console.error("[Email] Resend exception:", message);
      return { success: false, error: message };
    }
  }

  // 2. Try SMTP / Nodemailer if configured
  if (
    smtpHost &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_PASS !== "your-app-password" &&
    process.env.SMTP_USER !== "it-notifications@brandelier.in"
  ) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        tls: {
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
        },
      });

      await transporter.sendMail({
        from: fromEmail,
        to: toEmail,
        subject: `Your Brandelier Verification Code: ${sanitizedCode}`,
        html: emailHtml,
      });

      console.log(`[Email] SMTP successfully sent verification code to ${toEmail}`);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to send email via SMTP.";
      console.error("[Email] SMTP exception:", message);
      return { success: false, error: message };
    }
  }

  return {
    success: false,
    error: "No email delivery service is configured. Please check your email settings.",
  };
}

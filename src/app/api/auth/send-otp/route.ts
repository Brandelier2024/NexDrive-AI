import { NextRequest, NextResponse } from "next/server";
import { isCompanyEmail } from "@/lib/config";
import { createServerSupabaseClient } from "@/lib/supabase";
import { generateOtpCode, storeOtp, sendVerificationEmail } from "@/lib/email";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json(
        { error: "Email address is required." },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. Enforce corporate email domain
    if (!isCompanyEmail(normalizedEmail)) {
      const domain = process.env.ALLOWED_EMAIL_DOMAIN || "brandelier.in";
      return NextResponse.json(
        { error: `Only company email addresses are allowed. Please use your @${domain} email.` },
        { status: 403 }
      );
    }

    // 2. Rate Limiting: Per-IP (10 OTP requests / 10 mins) and Per-Email (3 OTP requests / 10 mins)
    const clientIp = getClientIp(req);
    const ipLimit = checkRateLimit(`otp:ip:${clientIp}`, {
      windowMs: 10 * 60 * 1000,
      max: 10,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many verification code requests from this network. Please wait a few minutes." },
        {
          status: 429,
          headers: { "Retry-After": String(ipLimit.retryAfterSeconds) },
        }
      );
    }

    const emailLimit = checkRateLimit(`otp:email:${normalizedEmail}`, {
      windowMs: 10 * 60 * 1000,
      max: 3,
    });
    if (!emailLimit.allowed) {
      return NextResponse.json(
        { error: "Too many verification code requests for this email. Please wait a few minutes before trying again." },
        {
          status: 429,
          headers: { "Retry-After": String(emailLimit.retryAfterSeconds) },
        }
      );
    }

    // 2. Check if user already exists
    try {
      const supabase = createServerSupabaseClient();
      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .eq("email", normalizedEmail)
        .single();

      if (existingUser) {
        return NextResponse.json(
          { error: "An account with this email already exists. Please sign in." },
          { status: 409 }
        );
      }
    } catch {
      // ignore
    }

    // 3. Generate 6-digit OTP code and store
    const code = generateOtpCode();
    await storeOtp(normalizedEmail, code);

    // 4. Send email
    const sendResult = await sendVerificationEmail(normalizedEmail, code);

    if (!sendResult.success) {
      return NextResponse.json(
        { error: sendResult.error || "Failed to send verification email. Please check configuration." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `A 6-digit verification code was sent to ${normalizedEmail}.`,
    });
  } catch (error: any) {
    console.error("[Send OTP Error]:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to send verification code." },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { isCompanyEmail } from "@/lib/config";
import { createServerSupabaseClient } from "@/lib/supabase";
import { verifyOtp } from "@/lib/email";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const { name, email, password, otp_code } = await req.json();

    // Validate required fields
    if (!name || !email || !password || !otp_code) {
      return NextResponse.json(
        { error: "Name, email, password, and the 6-digit verification code are required." },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Enforce company email domain
    if (!isCompanyEmail(normalizedEmail)) {
      return NextResponse.json(
        {
          error: `Only company email addresses are allowed. Please use your @${process.env.ALLOWED_EMAIL_DOMAIN || "brandelier.in"} email.`,
        },
        { status: 403 }
      );
    }

    // Rate Limiting: Per-IP (15 attempts / 15 mins) and Per-Email (5 attempts / 15 mins)
    const clientIp = getClientIp(req);
    const ipLimit = checkRateLimit(`signup:ip:${clientIp}`, {
      windowMs: 15 * 60 * 1000,
      max: 15,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many signup attempts from this IP. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(ipLimit.retryAfterSeconds) },
        }
      );
    }

    const emailLimit = checkRateLimit(`signup:email:${normalizedEmail}`, {
      windowMs: 15 * 60 * 1000,
      max: 5,
    });
    if (!emailLimit.allowed) {
      return NextResponse.json(
        { error: "Too many verification attempts for this email address. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(emailLimit.retryAfterSeconds) },
        }
      );
    }

    // Verify 6-digit email OTP code
    const isValidOtp = await verifyOtp(normalizedEmail, otp_code);
    if (!isValidOtp) {
      return NextResponse.json(
        { error: "Invalid or expired verification code. Please check your email or request a new code." },
        { status: 400 }
      );
    }

    // Validate password strength
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long." },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", email.toLowerCase())
      .single();

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please sign in." },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user in Supabase
    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password_hash: passwordHash,
        auth_provider: "credentials",
      })
      .select("id, name, email")
      .single();

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to create account. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        message: "Account created successfully! You can now sign in.",
        user: { id: newUser.id, name: newUser.name, email: newUser.email },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Signup error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const ALLOWED_DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN || "brandelier.in";

export default function SignUpPage() {
  const router = useRouter();

  // Step 1: details | Step 2: verify
  const [step, setStep] = useState<"details" | "verify">("details");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Countdown timer for resend OTP
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // Step 1: Validate details and send OTP code
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    // Domain validation
    if (!email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN.toLowerCase()}`)) {
      setError(`Only official @${ALLOWED_DOMAIN} email addresses are allowed.`);
      return;
    }

    // Password validation
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to send verification code. Please try again.");
      } else {
        setSuccess(`Verification code sent to ${email.trim()}`);
        setStep("verify");
        setResendCooldown(60);
      }
    } catch {
      setError("Network error while sending verification code. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (resendCooldown > 0 || loading) return;
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to resend code.");
      } else {
        setSuccess(`New verification code sent to ${email.trim()}!`);
        setResendCooldown(60);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify OTP and create account
  const handleVerifyAndSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!otpCode || otpCode.trim().length !== 6) {
      setError("Please enter the complete 6-digit verification code.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          otp_code: otpCode.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Sign up failed. Please check the code and try again.");
      } else {
        setSuccess("Account verified and created successfully! Redirecting to sign in…");
        setTimeout(() => {
          router.push("/auth/signin?registered=true");
        }, 1800);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-card">
          {/* Brand */}
          <div className="auth-brand">
            <div className="auth-brand-logo">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </div>
            <h1>{step === "details" ? "Create your account" : "Verify your email"}</h1>
            <p>
              {step === "details"
                ? "Join the DriveFinder AI platform"
                : `Enter the 6-digit code sent to your @${ALLOWED_DOMAIN} inbox`}
            </p>
          </div>

          {/* Alert Messages */}
          {error && (
            <div className="auth-alert auth-alert-error">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {success && (
            <div className="auth-alert auth-alert-success">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              {success}
            </div>
          )}

          {/* STEP 1: Enter Registration Details */}
          {step === "details" ? (
            <form className="auth-form" onSubmit={handleSendOtp}>
              <div className="form-group">
                <label className="form-label" htmlFor="signup-name">
                  Full Name
                </label>
                <div className="form-input-wrapper">
                  <svg className="form-input-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <input
                    id="signup-name"
                    className="form-input"
                    type="text"
                    placeholder="John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoComplete="name"
                    autoFocus
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="signup-email">
                  Company Email
                </label>
                <div className="form-input-wrapper">
                  <svg className="form-input-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                  <input
                    id="signup-email"
                    className="form-input"
                    type="email"
                    placeholder={`you@${ALLOWED_DOMAIN}`}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
                <span className="form-hint">Must be your authorized @{ALLOWED_DOMAIN} work email</span>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="signup-password">
                  Password
                </label>
                <div className="form-input-wrapper">
                  <svg className="form-input-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <input
                    id="signup-password"
                    className="form-input"
                    type={showPassword ? "text" : "password"}
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    style={{ paddingRight: "46px" }}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <line x1="1" y1="23" x2="23" y2="1" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="signup-confirm-password">
                  Confirm Password
                </label>
                <div className="form-input-wrapper">
                  <svg className="form-input-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  <input
                    id="signup-confirm-password"
                    className="form-input"
                    type={showPassword ? "text" : "password"}
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="auth-submit-btn"
                disabled={loading}
              >
                <span>
                  {loading && <span className="spinner" />}
                  {loading ? "Sending verification code…" : "Send Verification Code →"}
                </span>
              </button>
            </form>
          ) : (
            /* STEP 2: Enter 6-Digit Email Verification Code */
            <form className="auth-form" onSubmit={handleVerifyAndSignUp}>
              <div
                style={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 18,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                  <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {email}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStep("details");
                    setError("");
                    setSuccess("");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--color-primary)",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Change Email
                </button>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="otp-input" style={{ textAlign: "center", display: "block" }}>
                  6-Digit Verification Code
                </label>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <input
                    id="otp-input"
                    className="form-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="••••••"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                    required
                    autoFocus
                    style={{
                      textAlign: "center",
                      letterSpacing: "10px",
                      fontSize: "1.6rem",
                      fontWeight: 700,
                      maxWidth: "240px",
                      padding: "10px 14px",
                      fontFamily: "monospace",
                    }}
                  />
                </div>
                <span className="form-hint" style={{ textAlign: "center", display: "block", marginTop: 8 }}>
                  Check your inbox (or junk folder) for your corporate access code.
                </span>
              </div>

              <button
                type="submit"
                className="auth-submit-btn"
                disabled={loading || otpCode.length !== 6}
                style={{
                  opacity: otpCode.length === 6 ? 1 : 0.7,
                }}
              >
                <span>
                  {loading && <span className="spinner" />}
                  {loading ? "Verifying code…" : "Verify & Create Account"}
                </span>
              </button>

              <div style={{ textAlign: "center", marginTop: 14 }}>
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={resendCooldown > 0 || loading}
                  style={{
                    background: "none",
                    border: "none",
                    color: resendCooldown > 0 ? "var(--color-text-tertiary)" : "var(--color-primary)",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    cursor: resendCooldown > 0 ? "not-allowed" : "pointer",
                  }}
                >
                  {resendCooldown > 0
                    ? `Resend code in ${resendCooldown}s`
                    : "Didn't receive code? Resend"}
                </button>
              </div>
            </form>
          )}

          {/* Footer */}
          <div className="auth-footer">
            <p>
              Already have an account?{" "}
              <Link href="/auth/signin">Sign in</Link>
            </p>
            <div className="auth-domain-badge">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              @{ALLOWED_DOMAIN} verified accounts only
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

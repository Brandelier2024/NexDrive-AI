"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_DOMAIN: "Only company email addresses are allowed to sign in. Please use your work email.",
  USER_NOT_FOUND: "No account found. Please sign up first.",
  INVALID_CREDENTIALS: "Invalid email or password. Please try again.",
  Configuration: "There is a problem with the server configuration. Please contact your admin.",
  AccessDenied: "Access denied. You do not have permission to sign in.",
  Verification: "The sign-in link has expired. Please request a new one.",
  Default: "An unexpected error occurred during authentication. Please try again.",
};

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error") || "Default";
  const errorMessage = ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.Default;

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-card" style={{ textAlign: "center" }}>
          {/* Error Icon */}
          <div
            className="auth-brand-logo"
            style={{
              background: "linear-gradient(135deg, #ef4444, #dc2626)",
              boxShadow: "0 4px 24px rgba(239, 68, 68, 0.20)",
              margin: "0 auto 20px",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: 28, height: 28, color: "white" }}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>

          <h1
            style={{
              fontSize: "1.4rem",
              fontWeight: 700,
              color: "var(--color-text-primary)",
              marginBottom: 8,
            }}
          >
            Authentication Error
          </h1>

          <p
            style={{
              fontSize: "0.925rem",
              color: "var(--color-text-secondary)",
              lineHeight: 1.6,
              marginBottom: 28,
              maxWidth: 340,
              margin: "0 auto 28px",
            }}
          >
            {errorMessage}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Link href="/auth/signin">
              <button className="auth-submit-btn" type="button">
                <span>Back to Sign In</span>
              </button>
            </Link>
            <Link href="/auth/signup">
              <button
                className="auth-sso-btn"
                type="button"
                style={{ justifyContent: "center" }}
              >
                Create an Account
              </button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-page">
          <div className="auth-container">
            <div className="auth-card" style={{ textAlign: "center", padding: "40px" }}>
              <div className="spinner" style={{ margin: "0 auto" }} />
            </div>
          </div>
        </div>
      }
    >
      <AuthErrorContent />
    </Suspense>
  );
}

